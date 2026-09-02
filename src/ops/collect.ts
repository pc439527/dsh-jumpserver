/**
 * V0.3.0 Ops Investigation: collection engine + light metric parse.
 *
 * runProfileSweep drives ONE target-affinity batch turn per phase through the
 * conversation's SessionManager (enter->probe->commands in a single mutex
 * turn), so a triage on 'auto' reuses the already-entered asset for phase 2.
 * All commands are static READ commands (see ops/profiles.ts + the
 * READ-classification test), so no approval prompts fire in READ_ONLY.
 */
import type { SessionManager } from '../jumpserver/session-manager.js'
import { DETECT_PROFILE, LINUX_BASE, detectAppIds, errorCommands, linuxCommands, profileCommands, resolveProfile, sanitizeSince, type ProfileCommand } from './profiles.js'

export interface CollectedCommand {
  command: string
  category: string
  label: string | null
  exitCode: number | null
  output: string
  truncated: boolean
  error: { code: string; message: string } | null
}

export interface SweepResult {
  commands: CollectedCommand[]
  /** App profiles detected from the phase-1 detection sweep ('auto' mode). */
  detected: string[]
  /** Profile ids actually collected (linux + detected/explicit). */
  profilesUsed: string[]
  /** Verified hostname from the navigation probe. */
  hostname: string | null
  error: { code: string; message: string } | null
}

function collectedOf(batch: {
  commands: Array<{ command: string; executionState: string; exitCode: number | null; output: string; truncated: boolean; error: { code: string; message: string } | null }>
}, plan: ProfileCommand[]): CollectedCommand[] {
  return plan.map((p, i) => {
    const r = batch.commands[i]
    if (r === undefined) return { command: p.command, category: p.category, label: p.label ?? null, exitCode: null, output: '', truncated: false, error: { code: 'COLLECT_MISSING', message: 'command result missing' } }
    return {
      command: p.command,
      category: p.category,
      label: p.label ?? null,
      exitCode: r.exitCode,
      output: r.output,
      truncated: r.truncated,
      error: r.error,
    }
  })
}

export interface SweepOptions {
  /** 'auto' (default) detects apps then loads their profiles; a named profile forces it. */
  profile?: string
  since?: string
  signal?: AbortSignal
}

/** Phase-A: base sweep + detection commands (always run first). */
function phaseOne(profileId: string | undefined, since: string): { commands: ProfileCommand[]; names: ProfileCommand[] } {
  const base = linuxCommands(since)
  if (profileId !== undefined && profileId !== 'auto' && profileId !== '') {
    // explicit named profile: base + named profile (detection still cheap, skip phase-2 jumping)
    const p = resolveProfile(profileId)
    if (p === undefined) throw new Error('UNKNOWN_PROFILE: ' + profileId)
    return { commands: base, names: p.commands }
  }
  return { commands: [...base, ...DETECT_PROFILE.commands], names: [] }
}

export async function runProfileSweep(manager: SessionManager, target: string, options: SweepOptions = {}): Promise<SweepResult> {
  const profileId = (options.profile ?? 'auto').trim()
  const since = sanitizeSince(options.since)
  const phase1 = await manager.runTargetBatch({
    target,
    commands: phaseOne(profileId, since).commands.map((c) => ({ command: c.command, risk: 'READ' })),
    signal: options.signal,
  })
  if (phase1.error !== null) {
    return { commands: [], detected: [], profilesUsed: [], hostname: null, error: phase1.error }
  }
  const hostname = phase1.hostname
  const first = collectedOf(phase1, phaseOne(profileId, since).commands)

  let profilesUsed: string[] = ['linux']
  let detected: string[] = []
  let extra: ProfileCommand[] = []
  if (profileId === 'auto' || profileId === '') {
    const detectionText = first
      .filter((c) => c.category === 'detect')
      .map((c) => c.output)
      .join('\n')
    detected = detectAppIds(detectionText)
    profilesUsed = ['linux', ...detected]
    for (const id of detected) {
      const p = resolveProfile(id)
      if (p !== undefined) extra.push(...profileCommands(p, since))
    }
  } else {
    const p = resolveProfile(profileId)
    if (p !== undefined) {
      extra.push(...profileCommands(p, since))
      profilesUsed = ['linux', p.id]
    }
  }
  profilesUsed = [...new Set(profilesUsed)]

  let second: CollectedCommand[] = []
  if (extra.length > 0) {
    const phase2 = await manager.runTargetBatch({
      target,
      commands: extra.map((c) => ({ command: c.command, risk: 'READ' })),
      signal: options.signal,
    })
    if (phase2.error === null) second = collectedOf(phase2, extra)
    // navigation error on phase 2: keep phase-1 evidence, note the gap
  }

  return { commands: [...first, ...second], detected, profilesUsed, hostname, error: null }
}

// ---------- light metric parsers + findings ----------

export interface NodeMetrics {
  hostname: string | null
  load1: number | null
  memPct: number | null
  diskRootPct: number | null
  procCount: number | null
  errorCount: number | null
}

function firstInt(text: string): number | null {
  const m = /(\d+)/.exec(text.trim())
  return m !== null ? Number(m[1]) : null
}

export function parseUptime(text: string): { load1: number | null; load5: number | null; load15: number | null } {
  const m = /load average:\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(text)
  if (m === null) return { load1: null, load5: null, load15: null }
  return { load1: Number(m[1]), load5: Number(m[2]), load15: Number(m[3]) }
}

export function parseFreeMem(text: string): { totalMb: number | null; usedPct: number | null } {
  const m = /^Mem:\s*([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d]+)\s+([\d]+)/m.exec(text)
  if (m === null) return { totalMb: null, usedPct: null }
  const total = Number(m[1])
  const used = Number(m[2])
  const avail = Number(m[6])
  return { totalMb: total, usedPct: Math.round(((total - avail) / total) * 100) }
}

export function parseDfRoot(text: string): number | null {
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const parts = line.split(/\s+/)
    if (parts.length >= 6 && parts[parts.length - 1] === '/') {
      const use = parts[parts.length - 2] ?? ''
      const pct = /(\d+)%/.exec(use)
      if (pct !== null) return Number(pct[1])
    }
  }
  return null
}

/** Derive red-flag findings from collected commands (root-cause hypotheses seed). */
export function deriveFindings(commands: CollectedCommand[]): string[] {
  const findings: string[] = []
  for (const c of commands) {
    const out = c.output.trim()
    if (c.category === 'process' && c.command.includes('zombie_count')) {
      const m = /zombie_count=(\d+)/.exec(out)
      const n = m !== null ? Number(m[1]) : 0
      if (n > 0) findings.push('zombie processes: ' + n)
      continue
    }
    if (c.command.startsWith('free -m')) {
      const mem = parseFreeMem(out)
      if (mem.usedPct !== null && mem.usedPct >= 90) findings.push('memory usage ' + mem.usedPct + '% (>=90%)')
      continue
    }
    if (c.command.startsWith('df -h')) {
      const diskRoot = parseDfRoot(out)
      if (diskRoot !== null && diskRoot >= 85) findings.push('root disk usage ' + diskRoot + '% (>=85%)')
      continue
    }
    if (c.category === 'errors' && out.length > 0 && c.exitCode === 0) {
      findings.push('error-window output present: ' + c.command.slice(0, 60))
      continue
    }
    if (c.category === 'service' && /failed/i.test(out)) {
      findings.push('service check shows failed units: ' + c.command.slice(0, 60))
      continue
    }
    if (c.command.includes('nginx -t') && /fail|error/i.test(out)) {
      findings.push('nginx -t reports a config problem')
      continue
    }
  }
  return [...new Set(findings)]
}

/** The compact metric command set jumpserver_compare runs per target. */
export function compareCommands(since: string): ProfileCommand[] {
  return [
    { command: 'hostname', category: 'identity' },
    { command: 'uptime', category: 'identity' },
    { command: 'free -m', category: 'cpu-mem' },
    { command: 'df -h', category: 'disk' },
    { command: 'ps -eo cmd | grep -Ec "[j]ava|[n]ginx|[r]esin|[t]omcat|[m]ysqld"', category: 'process', label: 'app process count' },
    { command: 'journalctl -p err --since ' + since + ' --no-pager | wc -l', category: 'errors', label: 'error lines' },
  ]
}

export function metricsOf(commands: CollectedCommand[]): NodeMetrics {
  let hostname: string | null = null
  let load1: number | null = null
  let memPct: number | null = null
  let diskRootPct: number | null = null
  let procCount: number | null = null
  let errorCount: number | null = null
  for (const c of commands) {
    const out = c.output
    if (c.command === 'hostname') hostname = out.trim() || null
    else if (c.command === 'uptime') load1 = parseUptime(out).load1
    else if (c.command === 'free -m') memPct = parseFreeMem(out).usedPct
    else if (c.command === 'df -h') diskRootPct = parseDfRoot(out)
    else if (c.label === 'app process count') procCount = firstInt(out)
    else if (c.label === 'error lines') errorCount = firstInt(out)
  }
  return { hostname, load1, memPct, diskRootPct, procCount, errorCount }
}
