/**
 * Fleet inspection / collection tools (V0.4.0–V0.5.x, ported from
 * jumpserver-mcp v0.5.13).
 *
 *   jumpserver_inspect          - fixed read-only probe profiles -> HostInventory
 *   jumpserver_topology         - evidence-annotated relationship graph
 *   jumpserver_profile_run      - run a NAMED runbook across targets (PASS/FAIL)
 *   jumpserver_baseline_capture - snapshot a named baseline
 *   jumpserver_baseline_compare - re-inspect and report DRIFT
 *
 * Safety contract inherited from the ported modules (do not weaken):
 *  - every probe is a reviewed READ command; a probe that regresses to a
 *    non-READ rule is SKIPPED and reported, never silently downgraded;
 *  - a runbook step that is not READ is skipped and reported, so a runbook is
 *    READ_ONLY-safe by construction;
 *  - target scope is enforced inside the modules AND at tool entry;
 *  - targets are processed with bounded concurrency (batchConcurrency); one
 *    conversation still owns exactly ONE bastion PTY.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { jumpHomeBaselines } from '../runtime/paths.js'
import { resolveConcurrency, type JumpServerConfig } from '../config/types.js'
import type { SessionRegistry } from '../jumpserver/session-registry.js'
import { JUMPSERVER_NOT_ARMED, NOT_ARMED_MESSAGE, type SessionGrant } from '../security/grant.js'
import { inspectTargets } from '../jumpserver/inspector.js'
import { buildTopology } from '../jumpserver/topology.js'
import { resolveRunbook, runRunbook } from '../jumpserver/runbook.js'
import { requireTargetAllowed } from '../security/target-scope.js'
import { BaselineStore, diffBaseline, type Baseline, type BaselineHost } from '../runtime/baseline-store.js'
import type { HostInventory } from '../jumpserver/host-parse.js'
import { accountMap, bundleFor, guardValue, renderResult, sessionIdOf, type ResultValue } from './common.js'

const MAX_TARGETS = 20
const MAX_EDGES = 200

const COLLECT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    code: { type: 'string' },
    message: { type: 'string' },
    consoleUrl: { type: 'string' },
    detail: { type: 'string' },
    targets: { type: 'integer' },
    reachable: { type: 'integer' },
    durationMs: { type: 'number' },
    profiles: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
    hosts: { type: 'array', items: { type: 'object', additionalProperties: true } },
    nodes: { type: 'array', items: { type: 'object', additionalProperties: true } },
    edges: { type: 'array', items: { type: 'object', additionalProperties: true } },
    runbook: { type: 'string' },
    verdict: { type: 'string' },
    passed: { type: 'integer' },
    failed: { type: 'integer' },
    results: { type: 'array', items: { type: 'object', additionalProperties: true } },
    baseline: { type: 'string' },
    createdAt: { type: 'string' },
    comparedAt: { type: 'string' },
    changed: { type: 'integer' },
    unchanged: { type: 'integer' },
    unreachable: { type: 'integer' },
    drift: { type: 'array', items: { type: 'object', additionalProperties: true } },
    output: { type: 'string' },
  },
} as const

function notArmed(): ResultValue {
  return { ok: false, code: JUMPSERVER_NOT_ARMED, message: NOT_ARMED_MESSAGE }
}

function requireGrant(grants: SessionGrant, exec: { agent?: { session: { header: { id: string } } } | undefined }): ResultValue | null {
  return grants.isGranted(sessionIdOf(exec as never)) ? null : notArmed()
}

/** Accept an array or a comma/space separated string, and bound the fan-out. */
function targetList(raw: unknown): { targets: string[]; error: string | null } {
  const values = Array.isArray(raw)
    ? raw.map((v) => String(v ?? ''))
    : typeof raw === 'string'
      ? raw.split(/[,\s]+/)
      : []
  const targets = values.map((v) => v.trim()).filter((v) => v.length > 0)
  if (targets.length === 0) return { targets: [], error: 'at least one target is required' }
  if (targets.length > MAX_TARGETS) return { targets: [], error: 'too many targets (max ' + MAX_TARGETS + ')' }
  return { targets: [...new Set(targets)], error: null }
}

/** Accept one profile name or a comma/space separated list. */
function profileList(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string') return undefined
  const names = raw.split(/[,\s]+/).map((n) => n.trim()).filter((n) => n.length > 0)
  return names.length > 0 ? names : undefined
}

/** Project a full HostInventory down to the compact, model-facing shape. */
function toBaselineHost(inv: HostInventory): BaselineHost {
  return {
    target: inv.target,
    hostname: inv.hostname,
    reachable: inv.reachable,
    error: inv.error,
    os: inv.os.name !== null ? [inv.os.name, inv.os.version].filter(Boolean).join(' ') : null,
    kernel: inv.kernel,
    cores: inv.cores,
    memoryTotalMb: inv.memory.totalMb,
    memoryUsedPct: inv.memory.usedPct,
    load: inv.load,
    disks: inv.disks.map((d) => ({ mount: d.mount, usePct: d.usePct })),
    listening: inv.listening.map((l) => ({ port: l.port, process: l.process })),
    services: inv.services,
    roles: inv.roles,
  }
}

function renderHost(host: Record<string, unknown>): string[] {
  const lines: string[] = []
  const head = '== ' + String(host['target'] ?? '?') + (host['hostname'] !== null && host['hostname'] !== undefined ? '  ' + String(host['hostname']) : '')
  lines.push(head)
  if (host['reachable'] === false) {
    lines.push('   unreachable: ' + String(host['error'] ?? 'unknown error'))
    return lines
  }
  const os = host['os'] !== null && host['os'] !== undefined ? String(host['os']) : '?'
  const kernel = host['kernel'] !== null && host['kernel'] !== undefined ? String(host['kernel']) : '?'
  const cores = host['cores'] !== null && host['cores'] !== undefined ? String(host['cores']) : '?'
  lines.push('   os=' + os + ' kernel=' + kernel + ' cores=' + cores)
  const load = Array.isArray(host['load']) ? (host['load'] as unknown[]).join('/') : '?'
  const memPct = host['memoryUsedPct'] !== null && host['memoryUsedPct'] !== undefined ? String(host['memoryUsedPct']) + '%' : '?'
  const memTotal = host['memoryTotalMb'] !== null && host['memoryTotalMb'] !== undefined ? String(host['memoryTotalMb']) + 'MB' : '?'
  lines.push('   memory=' + memPct + ' of ' + memTotal + ' load=' + load)
  const roles = Array.isArray(host['roles']) ? (host['roles'] as unknown[]) : []
  if (roles.length > 0) lines.push('   roles: ' + roles.join(', '))
  const listening = Array.isArray(host['listening']) ? (host['listening'] as Array<Record<string, unknown>>) : []
  if (listening.length > 0) {
    lines.push('   listening: ' + listening.map((l) => String(l['port'] ?? '?') + (l['process'] !== null && l['process'] !== undefined ? '(' + String(l['process']) + ')' : '')).join(' '))
  }
  const disks = Array.isArray(host['disks']) ? (host['disks'] as Array<Record<string, unknown>>) : []
  const hot = disks.filter((d) => typeof d['usePct'] === 'number' && (d['usePct'] as number) >= 80)
  if (disks.length > 0) lines.push('   disks: ' + disks.map((d) => String(d['mount'] ?? '?') + '=' + String(d['usePct'] ?? '?') + '%').join(' '))
  for (const d of hot) lines.push('   ! disk ' + String(d['mount'] ?? '?') + ' at ' + String(d['usePct']) + '%')
  const services = Array.isArray(host['services']) ? (host['services'] as unknown[]) : []
  if (services.length > 0) lines.push('   services: ' + services.slice(0, 20).join(' '))
  return lines
}

function renderCollect(_args: Record<string, unknown>, value: ResultValue): Array<{ type: 'text'; text: string }> {
  const lines: string[] = []
  if (value['ok'] === true) lines.push('ok')
  if (value['code'] !== undefined) lines.push('code: ' + String(value['code']))
  if (value['message'] !== undefined) lines.push(String(value['message']))
  if (typeof value['detail'] === 'string' && (value['detail'] as string).length > 0) lines.push('detail: ' + String(value['detail']))
  if (value['baseline'] !== undefined) lines.push('baseline=' + String(value['baseline']) + (value['createdAt'] !== undefined ? ' createdAt=' + String(value['createdAt']) : '') + (value['comparedAt'] !== undefined ? ' comparedAt=' + String(value['comparedAt']) : ''))
  if (value['runbook'] !== undefined) {
    lines.push('runbook=' + String(value['runbook']) + (value['verdict'] !== null && value['verdict'] !== undefined ? ' verdict=' + String(value['verdict']).toUpperCase() : '') + (value['passed'] !== undefined ? ' passed=' + String(value['passed']) + ' failed=' + String(value['failed']) : ''))
  }
  if (value['targets'] !== undefined) lines.push('targets=' + String(value['targets']) + (value['reachable'] !== undefined ? ' reachable=' + String(value['reachable']) : '') + (value['durationMs'] !== undefined ? ' durationMs=' + String(value['durationMs']) : ''))
  const warnings = Array.isArray(value['warnings']) ? (value['warnings'] as unknown[]) : []
  for (const w of warnings) lines.push('note: ' + String(w))
  const driftCounters = value['changed'] !== undefined
  if (driftCounters) {
    lines.push('changed=' + String(value['changed']) + ' unchanged=' + String(value['unchanged']) + ' unreachable=' + String(value['unreachable']))
    if (value['changed'] === 0 && value['unreachable'] === 0) lines.push('(未检测到漂移)')
  }
  const hosts = Array.isArray(value['hosts']) ? (value['hosts'] as Array<Record<string, unknown>>) : []
  for (const host of hosts) {
    lines.push('')
    for (const l of renderHost(host)) lines.push(l)
  }
  const drift = Array.isArray(value['drift']) ? (value['drift'] as Array<Record<string, unknown>>) : []
  for (const host of drift) {
    if (host['status'] === 'unchanged') continue
    lines.push('')
    lines.push('== ' + String(host['target'] ?? '?') + '  [' + String(host['status'] ?? '?') + ']')
    const changes = Array.isArray(host['changes']) ? (host['changes'] as Array<Record<string, unknown>>) : []
    for (const c of changes) lines.push('   ~ ' + String(c['field'] ?? '?') + ': ' + String(c['before'] ?? '?') + ' -> ' + String(c['after'] ?? '?'))
    if (changes.length === 0) lines.push('   (no field-level detail)')
  }
  const edges = Array.isArray(value['edges']) ? (value['edges'] as Array<Record<string, unknown>>) : []
  const nodes = Array.isArray(value['nodes']) ? (value['nodes'] as Array<Record<string, unknown>>) : []
  if (nodes.length > 0) {
    lines.push('')
    lines.push('nodes=' + String(nodes.length) + ' edges=' + String(edges.length))
    for (const n of nodes) {
      const roles = Array.isArray(n['roles']) ? (n['roles'] as unknown[]) : []
      lines.push('  ' + String(n['target'] ?? n['id'] ?? '?') + (n['hostname'] !== null && n['hostname'] !== undefined ? ' ' + String(n['hostname']) : '') + (roles.length > 0 ? ' [' + roles.join(',') + ']' : ''))
    }
    for (const e of edges) {
      lines.push('  ' + String(e['from'] ?? '?') + ' -> ' + String(e['to'] ?? '?') + '  ' + String(e['type'] ?? '?') + '/' + String(e['confidence'] ?? '?') + (e['evidence'] !== null && e['evidence'] !== undefined ? '  (' + String(e['evidence']) + ')' : ''))
    }
  }
  const results = Array.isArray(value['results']) ? (value['results'] as Array<Record<string, unknown>>) : []
  for (const target of results) {
    lines.push('')
    lines.push('== ' + String(target['target'] ?? '?') + (target['hostname'] !== null && target['hostname'] !== undefined ? '  ' + String(target['hostname']) : '') + (target['verdict'] !== null && target['verdict'] !== undefined ? '  [' + String(target['verdict']).toUpperCase() + ']' : ''))
    if (target['error'] !== null && target['error'] !== undefined) {
      const err = target['error'] as Record<string, unknown>
      lines.push('   error=' + String(err['code'] ?? '?') + ': ' + String(err['message'] ?? '') + (err['detail'] !== undefined ? ' | ' + String(err['detail']) : ''))
      continue
    }
    const steps = Array.isArray(target['steps']) ? (target['steps'] as Array<Record<string, unknown>>) : []
    for (const step of steps) {
      lines.push('   [' + String(step['id'] ?? '?') + ']' + (step['title'] !== null && step['title'] !== undefined ? ' ' + String(step['title']) : '') + ' exit=' + String(step['exitCode'] ?? '?') + (step['verdict'] !== null && step['verdict'] !== undefined ? ' -> ' + String(step['verdict']).toUpperCase() : ''))
      const failures = Array.isArray(step['failures']) ? (step['failures'] as unknown[]) : []
      for (const f of failures) lines.push('      x ' + String(f))
      const error = step['error'] as Record<string, unknown> | null | undefined
      if (error !== null && error !== undefined) lines.push('      !! ' + String(error['code'] ?? '?') + ': ' + String(error['message'] ?? ''))
      const excerpt = typeof step['excerpt'] === 'string' ? (step['excerpt'] as string) : ''
      if (excerpt.length > 0) lines.push('      ' + excerpt.replace(/\n/g, '\n      '))
    }
  }
  if (typeof value['output'] === 'string' && (value['output'] as string).length > 0) {
    lines.push('--- output ---')
    lines.push(String(value['output']))
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/** Bound one step's captured output for the model. */
function excerptOf(text: string, max = 400): string {
  const trimmed = text.trim()
  return trimmed.length > max ? trimmed.slice(0, max) + ' …(truncated)' : trimmed
}

export function registerCollectionTools(
  ctx: Context,
  registry: SessionRegistry,
  getConfig: () => JumpServerConfig,
  grants: SessionGrant,
  baselines: BaselineStore,
): Array<() => void> {
  const disposers: Array<() => void> = []

  const targetsParam = {
    type: 'array',
    required: true,
    description: 'Target assets to survey (max ' + MAX_TARGETS + '), e.g. ["203.0.113.101", "203.0.113.102"]',
    items: { type: 'string' },
  } as const
  const accountByTargetParam = {
    type: 'object',
    additionalProperties: true,
    description: 'V0.5.3: per-target KoKo account id for multi-user assets, e.g. {"192.168.79.10": 1}. Targets without an entry behave as before.',
  } as const

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_inspect',
        description:
          'Run FIXED, pre-reviewed read-only probes on one or more targets and return a STRUCTURED host inventory (hostname/OS/kernel/cores/memory/load/disks/listening ports/services/roles/Java/containers/nginx upstreams). Use this instead of hand-writing a pile of shell commands: the probe set is audited, stable across hosts, and comparable. Profiles: basic (default) / network / process / service / web / java / database / container / full. A probe that no longer classifies as READ is SKIPPED and reported, never silently downgraded. Reads only — approval-free in READ_ONLY.',
        parameters: {
          targets: targetsParam,
          profile: { type: 'string', description: 'Probe profile: basic (default) | network | process | service | web | java | database | container | full (comma separated for several)' },
          accountByTarget: accountByTargetParam,
        },
        output: { schema: COLLECT_SCHEMA, render: renderCollect },
        timeoutMs: 1800000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const list = targetList(args.targets)
            if (list.error !== null) return { ok: false, code: 'INVALID_TARGETS', message: list.error }
            for (const target of list.targets) requireTargetAllowed(getConfig(), target)
            const bundle = bundleFor(exec, registry)
            const result = await inspectTargets(bundle.manager, getConfig, {
              targets: list.targets,
              profile: profileList(args.profile),
              signal: exec.signal,
              concurrency: resolveConcurrency(getConfig()).batchConcurrency,
              accountByTarget: accountMap(args.accountByTarget),
            })
            return {
              ok: true,
              targets: result.targets,
              reachable: result.reachable,
              profiles: result.profiles,
              durationMs: result.durationMs,
              warnings: result.warnings,
              hosts: result.inventories.map(toBaselineHost),
            }
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_topology',
        description:
          'Build an EVIDENCE-ANNOTATED relationship graph between hosts (who proxies whom, who connects where): nginx upstream / server_name, ESTABLISHED connections, /etc/hosts aliases and shared upstream clusters. Every edge carries a confidence (HIGH/MEDIUM/LOW) and the evidence it was derived from. Inspect the hosts first so the local asset caches and inventory are warm; this tool runs the network+web+process probes itself when needed.',
        parameters: {
          targets: targetsParam,
          accountByTarget: accountByTargetParam,
        },
        output: { schema: COLLECT_SCHEMA, render: renderCollect },
        timeoutMs: 1800000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const list = targetList(args.targets)
            if (list.error !== null) return { ok: false, code: 'INVALID_TARGETS', message: list.error }
            for (const target of list.targets) requireTargetAllowed(getConfig(), target)
            const bundle = bundleFor(exec, registry)
            const inspected = await inspectTargets(bundle.manager, getConfig, {
              targets: list.targets,
              profile: ['network', 'web', 'process'],
              signal: exec.signal,
              concurrency: resolveConcurrency(getConfig()).batchConcurrency,
              accountByTarget: accountMap(args.accountByTarget),
            })
            const topology = buildTopology(inspected.inventories, {})
            return {
              ok: true,
              targets: inspected.targets,
              reachable: inspected.reachable,
              durationMs: inspected.durationMs,
              warnings: [...inspected.warnings, ...topology.warnings],
              nodes: topology.nodes,
              edges: topology.edges.slice(0, MAX_EDGES),
            }
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_profile_run',
        description:
          'Run a NAMED runbook from the configured runbooks table against one or more targets: the SAME reviewed steps on every host, so the results are directly comparable. A step may carry expect assertions (contains / notContains / matches / exitCode / notEmpty / minLines / probe) and the runbook then returns a PASS/FAIL verdict per step, per target and overall. Steps that are not READ (or a typo in a profile name) are SKIPPED and reported — a runbook can never bypass the permission model. Use it when the same check must run everywhere.',
        parameters: {
          name: { type: 'string', required: true, description: 'Runbook name from config runbooks, case-insensitive' },
          targets: targetsParam,
          accountByTarget: accountByTargetParam,
        },
        output: { schema: COLLECT_SCHEMA, render: renderCollect },
        timeoutMs: 3600000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const list = targetList(args.targets)
            if (list.error !== null) return { ok: false, code: 'INVALID_TARGETS', message: list.error }
            for (const target of list.targets) requireTargetAllowed(getConfig(), target)
            const bundle = bundleFor(exec, registry)
            const def = resolveRunbook(getConfig().runbooks, String(args.name ?? ''))
            const result = await runRunbook(bundle.manager, getConfig, String(args.name ?? ''), def, {
              targets: list.targets,
              signal: exec.signal,
              concurrency: resolveConcurrency(getConfig()).batchConcurrency,
              accountByTarget: accountMap(args.accountByTarget),
            })
            return {
              ok: result.verdict !== 'fail',
              runbook: result.runbook,
              ...(result.verdict !== null ? { verdict: result.verdict } : {}),
              passed: result.passed,
              failed: result.failed,
              targets: result.targets,
              reachable: result.reachable,
              durationMs: result.durationMs,
              warnings: result.warnings,
              message: result.verdict !== null
                ? 'runbook ' + result.runbook + ': ' + result.verdict.toUpperCase() + ' (' + String(result.passed) + ' passed / ' + String(result.failed) + ' failed)'
                : 'runbook ' + result.runbook + ' completed (no assertions)',
              results: result.results.map((t) => ({
                target: t.target,
                ...(t.hostname !== null ? { hostname: t.hostname } : {}),
                ...(t.verdict !== null ? { verdict: t.verdict } : {}),
                error: t.error,
                steps: t.steps.map((s) => ({
                  id: s.id,
                  ...(s.title !== null ? { title: s.title } : {}),
                  kind: s.kind,
                  source: s.source,
                  ...(s.exitCode !== null ? { exitCode: s.exitCode } : {}),
                  durationMs: s.durationMs,
                  ...(s.check !== null ? { verdict: s.check.verdict, failures: s.check.failures } : {}),
                  error: s.error,
                  excerpt: excerptOf(s.output),
                })),
              })),
            }
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_baseline_capture',
        description:
          'Snapshot the current state of one or more targets into a NAMED baseline (ports, disks, services, roles, kernel, cores, OS). Run it while the fleet is known-good; jumpserver_baseline_compare later re-inspects the same targets and reports exactly what drifted. Load/memory jitter is deliberately suppressed so a baseline is not noisy.',
        parameters: {
          name: { type: 'string', required: true, description: 'Baseline name (letters, digits, dash, underscore, dot)' },
          targets: targetsParam,
          accountByTarget: accountByTargetParam,
        },
        output: { schema: COLLECT_SCHEMA, render: renderCollect },
        timeoutMs: 1800000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const list = targetList(args.targets)
            if (list.error !== null) return { ok: false, code: 'INVALID_TARGETS', message: list.error }
            for (const target of list.targets) requireTargetAllowed(getConfig(), target)
            const name = String(args.name ?? '').trim()
            const bundle = bundleFor(exec, registry)
            const result = await inspectTargets(bundle.manager, getConfig, {
              targets: list.targets,
              profile: 'full',
              signal: exec.signal,
              concurrency: resolveConcurrency(getConfig()).batchConcurrency,
              accountByTarget: accountMap(args.accountByTarget),
            })
            const baseline: Baseline = {
              name,
              createdAt: new Date().toISOString(),
              profile: 'full',
              targets: list.targets,
              hosts: result.inventories.map(toBaselineHost),
            }
            const path = baselines.save(baseline)
            return {
              ok: true,
              baseline: name,
              createdAt: baseline.createdAt,
              targets: result.targets,
              reachable: result.reachable,
              durationMs: result.durationMs,
              warnings: result.warnings,
              message: 'baseline saved: ' + path,
              hosts: baseline.hosts,
            }
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_baseline_compare',
        description:
          'Re-inspect the targets of a saved baseline and report DRIFT: new/removed listening ports, disk pressure changes, added/removed services and roles, kernel/core/OS changes. A target the bastion cannot reach is reported as unreachable — never as "unchanged". Use it after a change window, or on a schedule, to answer "what changed on these hosts".',
        parameters: {
          name: { type: 'string', required: true, description: 'Baseline name captured by jumpserver_baseline_capture' },
          targets: { type: 'array', description: 'Override the target set (default: the targets stored in the baseline)', items: { type: 'string' } },
          accountByTarget: accountByTargetParam,
        },
        output: { schema: COLLECT_SCHEMA, render: renderCollect },
        timeoutMs: 1800000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const stored = baselines.load(String(args.name ?? '').trim())
            const override = typeof args.targets === 'undefined' ? null : targetList(args.targets)
            if (override !== null && override.error !== null) return { ok: false, code: 'INVALID_TARGETS', message: override.error }
            const targets = override !== null ? override.targets : stored.targets
            for (const target of targets) requireTargetAllowed(getConfig(), target)
            const bundle = bundleFor(exec, registry)
            const result = await inspectTargets(bundle.manager, getConfig, {
              targets,
              profile: stored.profile.length > 0 ? stored.profile : 'full',
              signal: exec.signal,
              concurrency: resolveConcurrency(getConfig()).batchConcurrency,
              accountByTarget: accountMap(args.accountByTarget),
            })
            const drift = diffBaseline(stored, result.inventories.map(toBaselineHost), new Date().toISOString())
            return {
              ok: true,
              baseline: drift.baseline,
              createdAt: drift.createdAt,
              comparedAt: drift.comparedAt,
              changed: drift.changed,
              unchanged: drift.unchanged,
              unreachable: drift.unreachable,
              targets: result.targets,
              reachable: result.reachable,
              durationMs: result.durationMs,
              warnings: result.warnings,
              drift: drift.hosts.map((h) => ({ target: h.target, status: h.status, changes: h.changes })),
            }
          })
        },
      }),
    ),
  )

  return disposers
}

/** The directory the baseline store owns (kept next to the other DSH state). */
export function baselineDir(): string {
  return jumpHomeBaselines()
}
