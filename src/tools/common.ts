import { HarnessError } from '@deepseek-ai/dsh-llm'
import { TOOL_ABORTED, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { AbortRequestedError, JumpServerError, errorCodeOf } from '../jumpserver/errors.js'
import type { ExecOutcome, SessionStatus } from '../jumpserver/session.js'
import type { TargetBatchResult } from '../jumpserver/session-manager.js'
import type { SessionBundle } from '../jumpserver/session-registry.js'
import { ANONYMOUS_SESSION } from '../jumpserver/session-registry.js'
import { SessionState } from '../jumpserver/state-machine.js'
import type { AssetEntry } from '../jumpserver/asset-list.js'

/** Shared canonical output schema for every jumpserver_* tool. */
export const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    code: { type: 'string' },
    message: { type: 'string' },
    connected: { type: 'boolean' },
    configured: { type: 'boolean' },
    gateway: { type: 'string' },
    state: { type: 'string' },
    target: { type: 'string' },
    hostname: { type: 'string' },
    user: { type: 'string' },
    pwd: { type: 'string' },
    permissionMode: { type: 'string' },
    exitCode: { type: 'integer' },
    completed: { type: 'boolean' },
    executionState: { type: 'string' },
    output: { type: 'string' },
    truncated: { type: 'boolean' },
    durationMs: { type: 'number' },
    reconnectCount: { type: 'number' },
    pluginVersion: { type: 'string' },
    hostBuild: { type: 'string' },
    protocolVersion: { type: 'integer' },
  },
} as const

export type ResultValue = Record<string, unknown> & { ok: boolean }

/** Convert arbitrary runtime values into lossless JSON before tool completion. */
export function sanitizeToolOutput(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) {
    const code = (value as Error & { code?: unknown }).code
    const out: Record<string, unknown> = { name: value.name, message: value.message }
    if (code !== undefined) out['code'] = sanitizeToolOutput(code, seen)
    return out
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return { name: 'SerializationError', message: 'circular tool output removed' }
    seen.add(value)
    if (value instanceof Map) {
      const out: Record<string, unknown> = {}
      for (const [key, item] of value.entries()) {
        const clean = sanitizeToolOutput(item, seen)
        if (clean !== undefined) out[String(key)] = clean
      }
      return out
    }
    if (value instanceof Set) return [...value].map((item) => sanitizeToolOutput(item, seen) ?? null)
    if (Array.isArray(value)) return value.map((item) => sanitizeToolOutput(item, seen) ?? null)
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const clean = sanitizeToolOutput(item, seen)
      if (clean !== undefined) out[key] = clean
    }
    return out
  }
  return null
}

export function toLosslessJsonValue<T>(value: T): T {
  return sanitizeToolOutput(value) as T
}

/**
 * Resolve the authoritative DSH conversation id for one tool call.
 * DSH stores the SessionId on `agent.session.header.id`. V0.2.3 accidentally
 * read `agent.session.id` and then fell back to `agent.id`, which may identify
 * the composed agent rather than the conversation and therefore made multiple
 * conversations reuse one JumpServer bundle.
 *
 * Calls without an owning agent use the anonymous test/mock scope only;
 * production conversation calls never fall back to a shared agent identity.
 */
export function sessionIdOf(exec: ToolRunContext): string {
  const agent = exec.agent as { session?: { header?: { id?: unknown } } } | undefined
  const id = agent?.session?.header?.id
  return typeof id === 'string' && id.length > 0 ? id : ANONYMOUS_SESSION
}

/** The per-conversation bundle for one tool call (never shared across ids). */
export function bundleFor(exec: ToolRunContext, registry: { getOrCreate(sessionId: string): SessionBundle }): SessionBundle {
  return registry.getOrCreate(sessionIdOf(exec))
}

const LIVE_STATES = new Set<string>([
  SessionState.JUMPSERVER_MENU,
  SessionState.ASSET_SHELL,
  SessionState.COMMAND_RUNNING,
  SessionState.ENTERING_ASSET,
])

/** Strip null/undefined optional fields so the declared output schema stays satisfied. */
function dropNulls<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (v !== null && v !== undefined) out[k] = v
  }
  return out as T
}

export function statusToValue(status: SessionStatus & { configured: boolean; permissionMode: string }): ResultValue {
  return dropNulls({
    ok: true,
    connected: LIVE_STATES.has(status.state),
    configured: status.configured,
    gateway: status.gateway,
    state: status.state,
    target: status.target,
    hostname: status.hostname,
    user: status.user,
    pwd: status.pwd,
    permissionMode: status.permissionMode,
    reconnectCount: status.reconnectCount,
  })
}

export function execOutcomeToValue(status: SessionStatus & { configured: boolean; permissionMode: string }, outcome: ExecOutcome): ResultValue {
  const base = {
    ok: true as boolean,
    gateway: status.gateway,
    state: status.state,
    target: status.target,
    hostname: status.hostname,
    durationMs: outcome.durationMs,
  }
  switch (outcome.kind) {
    case 'completed':
      return dropNulls({
        ...base,
        completed: true,
        executionState: 'COMPLETED',
        exitCode: outcome.exitCode,
        output: outcome.output,
        truncated: outcome.truncated,
      } as unknown as Record<string, unknown>) as unknown as ResultValue
    case 'timeout':
      return dropNulls({
        ...base,
        ok: false,
        code: 'COMMAND_TIMEOUT',
        message:
          outcome.executionState === 'TIMEOUT'
            ? 'command timed out; the shell was interrupted (Ctrl+C) and re-verified - it remains usable'
            : 'command timed out and the shell could NOT be re-verified; the session collapsed to UNKNOWN - reconnect before continuing',
        completed: false,
        executionState: outcome.executionState,
        output: outcome.output,
        truncated: outcome.truncated,
      } as unknown as Record<string, unknown>) as unknown as ResultValue
    case 'signal-lost':
      return dropNulls({
        ...base,
        ok: false,
        code: 'CONNECTION_LOST',
        message: 'SSH connection lost during command execution',
        completed: false,
        executionState: 'UNKNOWN',
      } as unknown as Record<string, unknown>) as unknown as ResultValue
  }
}

export async function guardValue(exec: ToolRunContext, fn: () => Promise<ResultValue>): Promise<ResultValue> {
  try {
    return toLosslessJsonValue(await fn())
  } catch (error) {
    if (error instanceof AbortRequestedError || exec.signal.aborted === true) {
      throw new HarnessError('tool call aborted', TOOL_ABORTED)
    }
    if (error instanceof JumpServerError) {
      const value: ResultValue = { ok: false, code: error.code, message: redactSecret(error.message) }
      return value
    }
    throw new HarnessError(redactSecret(error instanceof Error ? error.message : String(error)), errorCodeOf(error))
  }
}

/** Errors are constructed without secrets; keep one projection point for future redaction rules. */
function redactSecret(text: string): string {
  return text
}

export function renderResult(_args: Record<string, unknown>, value: ResultValue): Array<{ type: 'text'; text: string }> {
  const lines: string[] = []
  if (value.ok === true) lines.push('ok')
  if (value.code !== undefined) lines.push('code: ' + String(value.code))
  if (value.message !== undefined) lines.push(String(value.message))
  if (value.state !== undefined) lines.push('state: ' + String(value.state))
  if (value.gateway !== undefined) lines.push('gateway: ' + String(value.gateway))
  if (value.target !== undefined) lines.push('target: ' + String(value.target))
  if (value.hostname !== undefined) lines.push('hostname: ' + String(value.hostname))
  if (value.pluginVersion !== undefined) {
    lines.push('pluginVersion: ' + String(value.pluginVersion) + ' hostBuild: ' + String(value.hostBuild ?? '?') + ' protocol: ' + String(value.protocolVersion ?? '?'))
  }
  if (value.user !== undefined) lines.push('user: ' + String(value.user))
  if (value.exitCode !== undefined) lines.push('exitCode: ' + String(value.exitCode))
  if (typeof value.output === 'string' && value.output.length > 0) {
    lines.push('--- output ---')
    lines.push(value.output)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

/** Compact readable projection of a multi-target batch. */
export function renderBatchResult(tasks: TargetBatchResult[]): ResultValue {
  const lines: string[] = []
  let totalDurationMs = 0
  let failed = 0
  for (const task of tasks) {
    const durationMs = task.commands.reduce((acc, c) => acc + (c.durationMs ?? 0), 0)
    totalDurationMs += durationMs
    if (task.error !== null) failed += 1
    for (const cmd of task.commands) {
      if (cmd.error !== null) failed += 1
    }
    lines.push('target=' + task.target + ' hostname=' + (task.hostname ?? '?') + ' commands=' + task.commands.length)
    if (task.error !== null) lines.push('  error=' + task.error.code + ': ' + task.error.message)
    for (const cmd of task.commands) {
      const rc = cmd.exitCode !== null ? String(cmd.exitCode) : '?'
      lines.push('  $ ' + cmd.command)
      if (cmd.error !== null) {
        lines.push('    error=' + cmd.error.code + ': ' + cmd.error.message)
        continue
      }
      lines.push('    exitCode=' + rc + ' state=' + cmd.executionState + ' durationMs=' + cmd.durationMs)
      const out = cmd.output.trim()
      if (out.length > 0) {
        lines.push('    --- output ---')
        lines.push(indent(out, 4))
      }
    }
  }
  return {
    ok: failed === 0,
    completed: failed === 0,
    message: 'batch completed: ' + tasks.length + ' target(s), ' + failed + ' error(s), ' + totalDurationMs + ' ms',
    output: lines.join('\n'),
    durationMs: totalDurationMs,
  }
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text.split('\n').map((l) => pad + l).join('\n')
}

/** Upper bound for the optional rawText passthrough (keeps model context slim). */
const MAX_RAW_TEXT_CHARS = 16384

/** Canonical structured value for jumpserver_assets (V0.2.5: footer verify fields; V0.2.6: group + gated rawText). */
export function assetsToValue(
  result: {
    assets: AssetEntry[]
    count: number
    filter: string | null
    group: string | null
    groupMatched: number
    truncated: boolean
    paged: boolean
    rawText: string
    rawRows: number
    parsedRows: number
    page: number | null
    pageSize: number | null
    totalPages: number | null
    reportedTotal: number | null
    complete: boolean
    health: string
  },
  options: { includeRawText?: boolean } = {},
): ResultValue {
  const rawText = options.includeRawText === true && result.rawText.length > 0
    ? (result.rawText.length > MAX_RAW_TEXT_CHARS ? result.rawText.slice(0, MAX_RAW_TEXT_CHARS) : result.rawText)
    : undefined
  return dropNulls({
    ok: true,
    count: result.assets.length,
    filter: result.filter,
    group: result.group,
    groupMatched: result.group !== null ? result.groupMatched : undefined,
    assets: result.assets.map((a) =>
      dropNulls({
        index: a.index,
        name: a.name,
        ip: a.ip,
        platform: a.platform,
        node: a.node,
        comment: a.comment,
      }),
    ),
    truncated: result.truncated,
    paged: result.paged,
    health: result.health,
    rawRows: result.rawRows,
    parsedRows: result.parsedRows,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
    reportedTotal: result.reportedTotal,
    complete: result.complete,
    rawText,
  } as unknown as Record<string, unknown>) as unknown as ResultValue
}

/** Text projection for the assets result: one compact line per row + notes. */
export function renderAssetsResult(_args: Record<string, unknown>, value: ResultValue): Array<{ type: 'text'; text: string }> {
  const lines: string[] = []
  const filter = value['filter']
  const assets = value['assets'] instanceof Array ? (value['assets'] as Array<Record<string, unknown>>) : []
  const group = value['group']
  const groupLine = typeof group === 'string' && group.length > 0
    ? ' group=' + group + ' groupMatched=' + String(value['groupMatched'] ?? 0)
    : ''
  lines.push('ok' + (filter !== undefined && filter !== null ? ' filter=' + String(filter) : '') + groupLine + ' count=' + String(assets.length))
  if (value['rawText'] !== undefined && value['rawText'] !== null) {
    lines.push('note: raw captured screen included (bounded to ' + String(typeof value['rawText'] === 'string' ? value['rawText'].length : 0) + ' chars)')
  }
  if (value['paged'] === true) lines.push('note: the list appears to be paged; results may be incomplete')
  if (value['truncated'] === true) lines.push('note: captured screen was truncated; results may be incomplete')
  const health = value['health']
  if (health === 'ASSET_CAPTURE_TIMEOUT') {
    lines.push('note: no asset-list output was captured (ASSET_CAPTURE_TIMEOUT) - the tool result is NOT an empty account; retry once')
  } else if (health === 'ASSET_CAPTURE_INCOMPLETE') {
    lines.push('note: only the p echo / menu prompt was captured, no asset payload (ASSET_CAPTURE_INCOMPLETE) - NOT an empty account; retry once or call with refresh:true')
  } else if (health === 'ASSET_PARSE_FAILED') {
    const rawRows = value['rawRows'] !== undefined ? String(value['rawRows']) : '?'
    lines.push('note: captured ' + rawRows + ' raw rows but parsed 0 (ASSET_PARSE_FAILED) - KoKo table format is not understood; this is a parser bug, not "no assets"')
  } else if (health === 'ASSET_LIST_EMPTY') {
    lines.push('note: KoKo confirmed an empty account (总数量 0 / explicit no-asset notice) - this IS "no assets"')
  }
  // V0.2.5: footer verification — parsedRows == reportedTotal is the only exact match.
  const total = value['reportedTotal']
  if (typeof total === 'number' && total >= 0) {
    const complete = value['complete'] === true
    lines.push('KoKo footer: reportedTotal=' + total + (complete ? ' (capture complete)' : ' (capture partial)'))
    if (complete) {
      const parsedRows = typeof value['parsedRows'] === 'number' ? value['parsedRows'] : -1
      if (parsedRows !== total) {
        lines.push('note: KoKo reports ' + total + ' assets but only ' + parsedRows + ' rows parsed - capture may be incomplete; retry with refresh:true')
      }
    }
  }
  if (assets.length === 0) lines.push('(no matching assets)')
  for (const a of assets) {
    const name = String(a['name'] ?? '?')
    const ip = a['ip'] !== undefined && a['ip'] !== null ? String(a['ip']) : null
    const platform = a['platform'] !== undefined && a['platform'] !== null ? String(a['platform']) : null
    const node = a['node'] !== undefined && a['node'] !== null ? String(a['node']) : null
    const comment = a['comment'] !== undefined && a['comment'] !== null ? String(a['comment']) : null
    const extras = [platform, node, comment].filter((v): v is string => v !== null && v !== undefined)
    lines.push((ip !== null ? ip : name) + (ip !== null ? '  ' + name : '') + (extras.length > 0 ? '  ' + extras.join('  ') : ''))
  }
  return [{ type: 'text', text: lines.join('\n') }]
}
