/**
 * V0.3.0 Ops Investigation tools:
 *   jumpserver_triage    - fixed read-only diagnostic sweep (auto-detect apps),
 *                           evidence into the conversation's case ledger
 *   jumpserver_compare   - metric normalization + diff across targets
 *   jumpserver_case      - investigation case: new/list/summary/evidence/
 *                           hypothesis/action/conclude/report (markdown|json)
 *   jumpserver_remediate - plan-level remediation: pre-check -> ONE approval ->
 *                           apply -> post-check (refused in READ_ONLY)
 *
 * Every tool keeps the session grant as the first permission boundary and
 * stays conversation-scoped through the SessionRegistry bundle.
 */
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { JumpServerConfig } from '../config/types.js'
import { AbortRequestedError, JumpServerError } from '../jumpserver/errors.js'
import type { SessionRegistry } from '../jumpserver/session-registry.js'
import { JUMPSERVER_NOT_ARMED, NOT_ARMED_MESSAGE, type SessionGrant } from '../security/grant.js'
import { classifyCommand } from '../security/command-classifier.js'
import { redactCommandSecrets } from '../security/command-redaction.js'
import type { OpsCaseRegistry } from '../ops/evidence.js'
import { deriveFindings, runProfileSweep, type CollectedCommand } from '../ops/collect.js'
import { compareTargets } from '../jumpserver/compare.js'
import { resolveConcurrency } from '../config/types.js'
import { requireTargetAllowed } from '../security/target-scope.js'
import { accountMap, bundleFor, guardValue, renderResult, sessionIdOf, type ResultValue } from './common.js'

const CMD_EXCERPT = 200

interface CompactCommand {
  category: string
  command: string
  exitCode?: number
  truncated: boolean
  outputLength: number
  excerpt: string
  failed: boolean
}

function compactOf(commands: CollectedCommand[]): CompactCommand[] {
  return commands.map((c) => ({
    category: c.category,
    command: redactCommandSecrets(c.command),
    ...(c.exitCode !== null ? { exitCode: c.exitCode } : {}),
    truncated: c.truncated,
    outputLength: c.output.length,
    excerpt: c.error !== null ? '(error ' + c.error.code + ': ' + c.error.message + ')' : c.output.slice(0, CMD_EXCERPT),
    failed: c.error !== null || (c.exitCode !== null && c.exitCode !== 0),
  }))
}

function notArmed(): ResultValue {
  return { ok: false, code: JUMPSERVER_NOT_ARMED, message: NOT_ARMED_MESSAGE }
}

function requireGrant(grants: SessionGrant, exec: ToolRunContext): ResultValue | null {
  return grants.isGranted(sessionIdOf(exec)) ? null : notArmed()
}

// ---------- shared shape (compare/remediate reuse the triage-style output) ----------

const OPS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    code: { type: 'string' },
    message: { type: 'string' },
    target: { type: 'string' },
    hostname: { type: 'string' },
    caseId: { type: 'string' },
    profiles: { type: 'array', items: { type: 'string' } },
    detected: { type: 'array', items: { type: 'string' } },
    findings: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'array', items: { type: 'string' } },
    targets: { type: 'array', items: { type: 'string' } },
    metrics: { type: 'object', additionalProperties: true },
    groups: { type: 'array', items: { type: 'object', additionalProperties: true } },
    outliers: { type: 'array', items: { type: 'object', additionalProperties: true } },
    rollbackSuggested: { type: 'array', items: { type: 'string' } },
    commands: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string' },
          command: { type: 'string' },
          exitCode: { type: 'integer' },
          truncated: { type: 'boolean' },
          outputLength: { type: 'integer' },
          excerpt: { type: 'string' },
          failed: { type: 'boolean' },
        },
      },
    },
  },
} as const

function renderOps(_args: Record<string, unknown>, value: ResultValue): Array<{ type: 'text'; text: string }> {
  const lines: string[] = []
  const target = value['target'] !== undefined && value['target'] !== null ? String(value['target']) : '?'
  const hostname = value['hostname'] !== undefined && value['hostname'] !== null ? ' (' + String(value['hostname']) + ')' : ''
  lines.push('ops target=' + target + hostname + ' case=' + String(value['caseId'] ?? '?'))
  const profiles = value['profiles'] instanceof Array ? (value['profiles'] as unknown[]) : []
  const detected = value['detected'] instanceof Array ? (value['detected'] as unknown[]) : []
  if (profiles.length > 0) lines.push('profiles: ' + profiles.join(', '))
  if (detected.length > 0) lines.push('detected apps: ' + detected.join(', '))
  if (value['message'] !== undefined && value['message'] !== null) lines.push(String(value['message']))
  const findings = value['findings'] instanceof Array ? (value['findings'] as unknown[]) : []
  for (const f of findings) lines.push('! ' + String(f))
  const commands = value['commands'] instanceof Array ? (value['commands'] as Array<Record<string, unknown>>) : []
  for (const c of commands) {
    const rc = c['exitCode'] !== undefined && c['exitCode'] !== null ? String(c['exitCode']) : '?'
    lines.push('  [' + String(c['category'] ?? '?') + '] rc=' + rc + ' $ ' + String(c['command'] ?? ''))
    const excerpt = typeof c['excerpt'] === 'string' && (c['excerpt'] as string).length > 0 ? String(c['excerpt']) : ''
    if (excerpt.length > 0) lines.push('      ' + excerpt.replace(/\n/g, '\n      '))
    if (c['failed'] === true) lines.push('      ^ flagged')
  }
  const evidence = value['evidence'] instanceof Array ? (value['evidence'] as unknown[]) : []
  if (evidence.length > 0) lines.push('evidence: ' + evidence.join(' '))
  return [{ type: 'text', text: lines.join('\n') }]
}

interface PlanShape {
  preCheck?: unknown
  change?: unknown
  rollback?: unknown
  postCheck?: unknown
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((v) => String(v)).filter((s) => s.trim().length > 0)
}

function evidenceInput(kind: 'triage' | 'compare' | 'remediate', target: string, hostname: string | null, c: CollectedCommand) {
  return {
    kind,
    target,
    hostname,
    category: c.category,
    command: redactCommandSecrets(c.command),
    exitCode: c.exitCode,
    output: c.output,
    truncated: c.truncated,
  }
}

export function registerOpsTools(
  ctx: Context,
  registry: SessionRegistry,
  getConfig: () => JumpServerConfig,
  grants: SessionGrant,
  cases: OpsCaseRegistry,
): Array<() => void> {
  const disposers: Array<() => void> = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_triage',
        description:
          "Run a FIXED read-only diagnostic sweep on one target through JumpServer (never guesses shell commands): linux base (identity/cpu-mem/disk/process/service/network) + error window (journalctl/dmesg), then with profile='auto' (default) detects the running apps (nginx/apache/java/resin/tomcat/node/mysql/oracle/redis/docker/kubernetes) and loads their read-only profiles automatically. Every command is a pre-audited READ command, so READ_ONLY mode stays approval-free. Results land in the conversation's Investigation Case as evidence (E-xxx ids); 'since' bounds the error window (e.g. '30m', '2h', default '30m').",
        parameters: {
          target: { type: 'string', required: true, description: 'Target asset IP or name, e.g. 203.0.113.101' },
          profile: { type: 'string', description: 'auto (default, detects apps) | linux | nginx | apache | java | resin | tomcat | node | mysql | oracle | redis | docker | kubernetes' },
          since: { type: 'string', description: "Error-window for journalctl/dmesg, e.g. '30m' '2h', default '30m'" },
        },
        output: { schema: OPS_SCHEMA, render: renderOps },
        timeoutMs: 900000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const sessionId = sessionIdOf(exec)
            const bundle = bundleFor(exec, registry)
            const target = String(args.target ?? '')
            if (target.trim().length === 0) return { ok: false, code: 'INVALID_TARGET', message: 'target is required' }
            const sweep = await runProfileSweep(bundle.manager, target, {
              profile: typeof args.profile === 'string' ? args.profile : 'auto',
              since: typeof args.since === 'string' ? args.since : undefined,
              signal: exec.signal,
            })
            if (sweep.error !== null) return { ok: false, code: sweep.error.code, message: sweep.error.message }
            let c = cases.current(sessionId)
            if (c === undefined) c = cases.newCase(sessionId, { title: 'Triage: ' + target, servers: [target] })
            const evidence: string[] = []
            for (const cmd of sweep.commands) {
              evidence.push(cases.appendEvidence(sessionId, evidenceInput('triage', target, sweep.hostname, cmd)).id)
            }
            return {
              ok: true,
              target,
              hostname: sweep.hostname ?? undefined,
              caseId: c.id,
              profiles: sweep.profilesUsed,
              detected: sweep.detected,
              findings: deriveFindings(sweep.commands),
              evidence,
              commands: compactOf(sweep.commands),
            }
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_compare',
        description:
          'Run the SAME read-only command (or inspect profile) on 2-20 targets through JumpServer and report the DIFF: identical outputs collapse into one group and every deviating target is listed with the exact lines it is MISSING or has EXTRA (order-insensitive, multiset-aware, so ss/ps ordering never fakes a difference). Use it to answer "which node is different" across a fleet — config drift, a package only one host has, a service listening somewhere else. Pass exactly one of command / profile (default profile=basic). Failed targets keep their own error code and are excluded from the diff. Evidence lands in the conversation\'s case ledger.',
        parameters: {
          targets: {
            type: 'array',
            required: true,
            description: 'Two to twenty target IPs/names, e.g. ["203.0.113.101","203.0.113.102"]',
            items: { type: 'string' },
          },
          command: { type: 'string', description: 'One simple read-only command to run on every target, e.g. "ss -lntp"' },
          profile: { type: 'string', description: 'Inspect profile to run on every target: basic (default) / network / process / service / web / java / database / container / full' },
          accountByTarget: {
            type: 'object',
            additionalProperties: true,
            description: 'V0.5.3: per-target KoKo account id for multi-user assets, e.g. {"192.168.79.10": 1}.',
          },
        },
        output: { schema: OPS_SCHEMA, render: renderOps },
        timeoutMs: 1800000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const sessionId = sessionIdOf(exec)
            const bundle = bundleFor(exec, registry)
            const rawTargets = Array.isArray(args.targets) ? args.targets.map((t) => String(t).trim()).filter((t) => t.length > 0) : []
            const targets = [...new Set(rawTargets)]
            if (targets.length < 2) return { ok: false, code: 'INVALID_COMPARE', message: 'compare requires at least two targets' }
            if (targets.length > 20) return { ok: false, code: 'INVALID_COMPARE', message: 'compare supports at most twenty targets' }
            const command = typeof args.command === 'string' && args.command.trim().length > 0 ? args.command : undefined
            const profile = typeof args.profile === 'string' && args.profile.trim().length > 0 ? args.profile : undefined
            if (command !== undefined && profile !== undefined) {
              return { ok: false, code: 'INVALID_COMPARE', message: 'pass either command or profile, not both' }
            }
            for (const target of targets) requireTargetAllowed(getConfig(), target)
            let c = cases.current(sessionId)
            if (c === undefined) c = cases.newCase(sessionId, { title: 'Compare: ' + targets.join(' vs '), servers: targets })
            // V0.4.1: one shared implementation (path-identical to jumpserver-mcp):
            // order-insensitive grouping + multiset outliers, failed hosts excluded
            // but keeping their own error code.
            const result = await compareTargets(bundle.manager, getConfig, {
              targets,
              ...(command !== undefined ? { command } : { profile: profile ?? 'basic' }),
              signal: exec.signal,
              concurrency: resolveConcurrency(getConfig()).batchConcurrency,
              accountByTarget: accountMap(args.accountByTarget),
            })
            const evidence: string[] = []
            const failures: string[] = []
            for (const target of result.results) {
              if (target.error !== null) {
                failures.push(target.target + ': ' + target.error.code + ' ' + target.error.message)
                continue
              }
              evidence.push(cases.appendEvidence(sessionId, {
                kind: 'compare',
                target: target.target,
                hostname: target.hostname,
                category: result.source,
                command: result.source,
                exitCode: target.exitCode,
                output: target.lines.join('\n'),
                truncated: target.truncated,
              }).id)
            }
            // groupBySignature reports the minority targets twice: once as the
            // majority group's outliers and once inside their own block. The
            // actionable projection is the majority comparison — each deviating
            // target listed ONCE with what it is missing / has extra.
            const outliers = (result.groups[0]?.outliers ?? []).map((o) => ({ target: o.target, missing: o.missing, extra: o.extra }))
            const findings = result.distinct <= 1
              ? ['所有目标输出一致（' + String(result.succeeded) + ' 台）']
              : outliers.map((o) => o.target + ' 与多数派不同：缺少 ' + String(o.missing.length) + ' 行，多出 ' + String(o.extra.length) + ' 行')
            return {
              ok: result.failed === 0,
              ...(result.failed > 0 ? { code: 'COMPARE_PARTIAL', message: failures.join('; ') } : {}),
              target: targets.join(','),
              caseId: c.id,
              profiles: [result.source],
              findings,
              evidence,
              targets,
              metrics: { distinct: result.distinct, succeeded: result.succeeded, failed: result.failed },
              groups: result.groups.map((group) => ({ signatureLines: group.signature.length, signature: group.signature.slice(0, 20), members: group.outliers.length })),
              outliers,
            }
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_case',
        description:
          "Work with the conversation's Investigation Case (created by jumpserver_triage/compare, or action=new): new (title/servers/symptoms), list, summary (default), evidence {caseId,evidenceId} (full stored excerpt), hypothesis {...}, action {...}, conclude {caseId,conclusion}, report {caseId,format:markdown|json}. Evidence records cite E-xxx ids so tickets/RCA do not depend on model memory.",
        parameters: {
          action: { type: 'string', required: true, description: 'new | list | summary | evidence | hypothesis | action | conclude | report' },
          caseId: { type: 'string', description: 'Case id (CASE-001...); defaults to the current case' },
          title: { type: 'string', description: 'action=new: case title' },
          servers: { type: 'array', items: { type: 'string' }, description: 'action=new: involved servers' },
          symptoms: { type: 'string', description: 'action=new: symptom description' },
          evidenceId: { type: 'string', description: 'action=evidence: E-xxx id' },
          hypothesis: { type: 'string', description: 'action=hypothesis: hypothesis text' },
          actionNote: { type: 'string', description: 'action=action: performed action' },
          conclusion: { type: 'string', description: 'action=conclude: root-cause conclusion' },
          format: { type: 'string', description: 'action=report: markdown (default) | json' },
        },
        output: { schema: OPS_SCHEMA, render: renderOps },
        timeoutMs: 60000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const sessionId = sessionIdOf(exec)
            const action = String(args.action ?? '').trim()
            const caseId = typeof args.caseId === 'string' && args.caseId.length > 0 ? args.caseId : undefined
            switch (action) {
              case 'new': {
                const c = cases.newCase(sessionId, {
                  title: typeof args.title === 'string' ? args.title : '',
                  servers: Array.isArray(args.servers) ? args.servers.map((s) => String(s)) : [],
                  symptoms: typeof args.symptoms === 'string' ? args.symptoms : '',
                })
                return { ok: true, caseId: c.id, message: 'created ' + c.id, target: c.servers.join(',') }
              }
              case 'list': {
                const list = cases.list(sessionId)
                return {
                  ok: true,
                  caseId: list.map((c) => c.id).join(','),
                  findings: list.map((c) => c.id + ' ' + c.title + ' evidence=' + c.evidence.size + (c.conclusion !== null ? ' concluded' : ' open')),
                }
              }
              case 'evidence': {
                const c = cases.get(sessionId, caseId)
                const record = typeof args.evidenceId === 'string' ? c?.evidence.get(args.evidenceId) : undefined
                if (record === undefined) {
                  return { ok: false, code: 'EVIDENCE_NOT_FOUND', message: 'no evidence ' + String(args.evidenceId ?? '?') + ' in ' + String(c?.id ?? 'current case') }
                }
                return {
                  ok: true,
                  caseId: c?.id,
                  target: record.target,
                  hostname: record.hostname ?? undefined,
                  message: record.command + ' [' + record.outputHash + ']',
                  commands: [{
                    category: record.category,
                    command: record.command,
                    exitCode: record.exitCode,
                    truncated: record.truncated,
                    outputLength: record.stdoutExcerpt.length,
                    excerpt: record.stdoutExcerpt,
                    failed: record.exitCode !== null && record.exitCode !== 0,
                  }],
                }
              }
              case 'summary': {
                const c = cases.get(sessionId, caseId)
                if (c === undefined) return { ok: false, code: 'NO_CASE', message: 'no investigation case found' }
                return {
                  ok: true,
                  caseId: c.id,
                  target: c.servers.join(','),
                  message: c.title + (c.symptoms.length > 0 ? ' — ' + c.symptoms : ''),
                  findings: [
                    'evidence=' + c.evidence.size,
                    'hypotheses=' + c.hypotheses.length,
                    'actions=' + c.actions.length,
                    'conclusion=' + (c.conclusion !== null ? 'set' : 'pending'),
                  ],
                  evidence: c.evidence.list().map((r) => r.id),
                }
              }
              case 'hypothesis': {
                const c = cases.addHypothesis(sessionId, String(args.hypothesis ?? ''), caseId)
                return { ok: true, caseId: c.id, findings: c.hypotheses }
              }
              case 'action': {
                const c = cases.recordAction(sessionId, String(args.actionNote ?? ''), caseId)
                return { ok: true, caseId: c.id, findings: c.actions }
              }
              case 'conclude': {
                const c = cases.conclude(sessionId, String(args.conclusion ?? ''), caseId)
                return { ok: true, caseId: c.id, message: c.conclusion ?? '' }
              }
              case 'report': {
                const c = cases.get(sessionId, caseId)
                if (c === undefined) return { ok: false, code: 'NO_CASE', message: 'no investigation case found' }
                const format = typeof args.format === 'string' ? args.format : 'markdown'
                if (format === 'json') return { ok: true, caseId: c.id, message: cases.renderJson(c), target: 'json' }
                return { ok: true, caseId: c.id, message: cases.renderMarkdown(c), target: 'markdown' }
              }
              default:
                return { ok: false, code: 'INVALID_ACTION', message: 'unknown case action: ' + action }
            }
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_remediate',
        description:
          'Plan-level remediation on one target: runs the read-only preCheck commands, then asks for ONE approval covering the whole plan (pre-results + change + rollback + postCheck), then applies change and runs postCheck. Refused in READ_ONLY mode. On a change-step failure it STOPS, reports the failed command and returns the rollback commands as guidance (rollback itself is never auto-executed). Every executed command is appended to the conversation case as evidence.',
        parameters: {
          target: { type: 'string', required: true, description: 'Target asset IP or name' },
          plan: {
            type: 'object',
            required: true,
            additionalProperties: false,
            description: '{ preCheck: read-only commands, change: the modification commands, rollback: reversal commands, postCheck: read-only verification commands }',
            properties: {
              preCheck: { type: 'array', items: { type: 'string' } },
              change: { type: 'array', required: true, items: { type: 'string' } },
              rollback: { type: 'array', items: { type: 'string' } },
              postCheck: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        output: { schema: OPS_SCHEMA, render: renderOps },
        timeoutMs: 1800000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const sessionId = sessionIdOf(exec)
            const bundle = bundleFor(exec, registry)
            const mode = getConfig().permissionMode
            if (mode === 'READ_ONLY') {
              return { ok: false, code: 'REMEDIATE_READ_ONLY', message: 'remediation changes server state and is refused in READ_ONLY; switch to AUTO (whole-plan approval) or FULL_ACCESS' }
            }
            const target = String(args.target ?? '').trim()
            if (target.length === 0) return { ok: false, code: 'INVALID_TARGET', message: 'target is required' }
            const plan = (args.plan ?? {}) as PlanShape
            const preCheck = stringArray(plan.preCheck)
            const change = stringArray(plan.change)
            const rollback = stringArray(plan.rollback)
            const postCheck = stringArray(plan.postCheck)
            if (change.length === 0) return { ok: false, code: 'INVALID_PLAN', message: 'plan.change must contain at least one command' }
            if (!preCheck.every((cmd) => classifyCommand(cmd).risk === 'READ') || !postCheck.every((cmd) => classifyCommand(cmd).risk === 'READ')) {
              return { ok: false, code: 'INVALID_PLAN', message: 'plan.preCheck and plan.postCheck must be read-only commands' }
            }
            let c = cases.current(sessionId)
            if (c === undefined) c = cases.newCase(sessionId, { title: 'Remediate: ' + target, servers: [target] })
            const evidence: string[] = []

            const runBatch = async (commands: Array<{ command: string; risk: string }>): Promise<{ collected: CollectedCommand[]; hostname: string | null } | null> => {
              const classified = commands.map((item) => {
                const c = classifyCommand(item.command)
                return {
                  command: item.command,
                  risk: c.risk,
                  classification: { risk: c.risk, reason: c.reason, ruleId: c.ruleId, confidence: c.confidence, classifierVersion: c.classifierVersion, normalizedCommand: c.normalizedCommand },
                }
              })
              const batch = await bundle.manager.runTargetBatch({ target, commands: classified, signal: exec.signal })
              if (batch.error !== null) return null
              return {
                hostname: batch.hostname,
                collected: commands.map((item, i) => {
                  const r = batch.commands[i]
                  return { command: item.command, category: 'change', label: null, exitCode: r?.exitCode ?? null, output: r?.output ?? '', truncated: r?.truncated ?? false, error: r?.error ?? null }
                }),
              }
            }
            const recordEvidence = (run: { collected: CollectedCommand[]; hostname: string | null }): void => {
              for (const cmd of run.collected) {
                evidence.push(cases.appendEvidence(sessionId, evidenceInput('remediate', target, run.hostname, cmd)).id)
              }
            }

            // pre-check (read-only, before the plan approval)
            const preRun = preCheck.length > 0 ? await runBatch(preCheck.map((command) => ({ command, risk: 'READ' }))) : null
            if (preRun !== null) recordEvidence(preRun)
            const preCollected = preRun?.collected ?? []

            // ONE plan-level approval (AUTO: any modification; FULL_ACCESS: DANGEROUS only)
            const planText = planToText(target, preCollected, change, rollback, postCheck)
            const approval = ctx.get('approval') as { request?: (opts: Record<string, unknown>) => Promise<string> } | undefined
            const anyDangerous = change.some((cmd) => classifyCommand(cmd).risk === 'DANGEROUS')
            const needApproval = mode === 'AUTO' || anyDangerous
            if (needApproval) {
              if (approval?.request === undefined || exec.agent === undefined) {
                throw new JumpServerError('COMMAND_APPROVAL_REQUIRED', 'approval service unavailable; the remediation plan was not executed')
              }
              const outcome = await approval.request({
                agent: exec.agent,
                toolName: exec.name,
                callId: exec.callId,
                reason: planText,
                signal: exec.signal,
              })
              if (outcome !== 'allowed-once') {
                throw new JumpServerError('COMMAND_BLOCKED', 'the remediation plan was ' + outcome + '; no command ran')
              }
            }

            // apply change
            const changeRun = await runBatch(change.map((command) => ({ command, risk: classifyCommand(command).risk })))
            if (changeRun === null) {
              return { ok: false, code: 'REMEDIATE_NAVIGATION_FAILED', message: 'could not reach ' + target + ' for the apply step', caseId: c.id, rollbackSuggested: rollback, evidence }
            }
            recordEvidence(changeRun)
            const failedStep = changeRun.collected.find((cmd) => cmd.error !== null || (cmd.exitCode !== null && cmd.exitCode !== 0))
            if (failedStep !== undefined) {
              return {
                ok: false,
                code: 'REMEDIATE_CHANGE_STEP_FAILED',
                message: 'change step failed: ' + failedStep.command + ' (exit ' + String(failedStep.exitCode ?? '?') + '); stopped before postCheck',
                target,
                caseId: c.id,
                rollbackSuggested: rollback,
                evidence,
                commands: compactOf(changeRun.collected),
              }
            }

            // post-check (read-only)
            const postRun = postCheck.length > 0 ? await runBatch(postCheck.map((command) => ({ command, risk: 'READ' }))) : null
            if (postRun !== null) recordEvidence(postRun)
            cases.recordAction(sessionId, 'remediated ' + target + ': ' + change.join('; '))
            return {
              ok: true,
              target,
              caseId: c.id,
              profiles: ['remediate'],
              findings: [],
              evidence,
              commands: [...compactOf(changeRun.collected), ...compactOf(postRun?.collected ?? [])],
            }
          })
        },
      }),
    ),
  )

  return disposers
}


function planToText(target: string, pre: CollectedCommand[], change: string[], rollback: string[], postCheck: string[]): string {
  const lines: string[] = []
  lines.push('Remediation Plan — target ' + target)
  lines.push('')
  lines.push('Pre-check results:')
  if (pre.length === 0) lines.push('  (none)')
  for (const c of pre) lines.push('  rc=' + String(c.exitCode ?? '?') + ' $ ' + c.command)
  lines.push('')
  lines.push('Change (will be applied):')
  for (const cmd of change) lines.push('  $ ' + cmd)
  lines.push('')
  lines.push('Rollback (on failure, provided as guidance):')
  for (const cmd of rollback) lines.push('  $ ' + cmd)
  lines.push('')
  lines.push('Post-check:')
  for (const cmd of postCheck) lines.push('  $ ' + cmd)
  lines.push('')
  lines.push('一次审批覆盖整个计划。是否执行？')
  return lines.join('\n')
}
