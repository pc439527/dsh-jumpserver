import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { JumpServerConfig } from '../config/types.js'
import { AbortRequestedError, JumpServerError } from '../jumpserver/errors.js'
import type { SessionRegistry } from '../jumpserver/session-registry.js'
import { gateCommand, gateCommandForNavigation, type GateServices } from '../security/permission-gate.js'
import { JUMPSERVER_NOT_ARMED, NOT_ARMED_MESSAGE, type SessionGrant } from '../security/grant.js'
import type { TargetBatchResult } from '../jumpserver/session-manager.js'
import { runtimeVersion } from '../version.js'
import { assetsToValue, bundleFor, execOutcomeToValue, guardValue, renderAssetsResult, renderBatchResult, renderResult, RESULT_SCHEMA, sessionIdOf, statusToValue, type ResultValue } from './common.js'

function thisJumpError(error: unknown): { code: string; message: string } {
  if (error instanceof JumpServerError) return { code: error.code, message: error.message }
  return { code: 'FAILED', message: error instanceof Error ? error.message : String(error) }
}

/** V0.2.4 P0: the session-grant gate is the FIRST permission boundary (see security/grant.ts). */
function notArmed(): ResultValue {
  return { ok: false, code: JUMPSERVER_NOT_ARMED, message: NOT_ARMED_MESSAGE }
}

/** Returns the not-armed value when this conversation's grant is locked, else null. */
function requireGrant(grants: SessionGrant, exec: ToolRunContext): ResultValue | null {
  return grants.isGranted(sessionIdOf(exec)) ? null : notArmed()
}

/** Canonical output schema for jumpserver_assets (V0.2.3 P1, V0.2.4: health + platform/node). */
export const ASSETS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    code: { type: 'string' },
    message: { type: 'string' },
    count: { type: 'integer' },
    filter: { type: 'string' },
    assets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          name: { type: 'string' },
          ip: { type: 'string' },
          platform: { type: 'string' },
          node: { type: 'string' },
          comment: { type: 'string' },
        },
      },
    },
    truncated: { type: 'boolean' },
    paged: { type: 'boolean' },
    health: { type: 'string' },
    rawRows: { type: 'integer' },
    parsedRows: { type: 'integer' },
    page: { type: 'integer' },
    pageSize: { type: 'integer' },
    totalPages: { type: 'integer' },
    reportedTotal: { type: 'integer' },
    complete: { type: 'boolean' },
    group: { type: 'string' },
    groupMatched: { type: 'integer' },
    rawText: { type: 'string' },
  },
} as const

/**
 * Register the jumpserver_* tools and return their disposers. V0.2.3 P0:
 * every tool routes through the conversation-scoped SessionRegistry using
 * exec.agent.session.id, so 对话 A and 对话 B never share a PTY/mutex/
 * terminal stream. V0.2.3 P1 adds jumpserver_assets (KoKo 'p' -> local filter).
 */
export function registerJumpServerTools(ctx: Context, registry: SessionRegistry, getConfig: () => JumpServerConfig, grants: SessionGrant, terminateConversation?: (sessionId: string) => Promise<unknown>): Array<() => void> {
  const disposers: Array<() => void> = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_status',
        description:
          'Query the current JumpServer connector state for YOUR conversation: whether a session exists, which bastion gateway it uses, which target asset is entered (verified via probe), and the current permission mode. Never returns credentials.',
        parameters: {},
        output: { schema: RESULT_SCHEMA, render: renderResult },
        async execute(_args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const bundle = bundleFor(exec, registry)
            // V0.2.6 P0 version handshake: the Agent sees exactly which Host
            // build answered (pluginVersion/hostBuild/protocolVersion) so a
            // stale deployed Host is diagnosable without guessing.
            return { ...statusToValue(bundle.manager.status()), ...runtimeVersion() }
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_connect',
        description:
          'Establish the persistent JumpServer SSH session for YOUR conversation and wait until the JumpServer menu is detected. If a session already exists for this conversation, this does NOT create a second one; it simply returns the current state. A different conversation never shares this session.',
        parameters: {},
        output: { schema: RESULT_SCHEMA, render: renderResult },
        async execute(_args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const bundle = bundleFor(exec, registry)
            const status = await bundle.manager.connect(exec.signal)
            return statusToValue(status)
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_enter',
        description:
          'Enter a target asset THROUGH THE JumpServer menu for your conversation by its IP/name. Requires the conversation session to be at the JumpServer menu. Internally runs a target probe (hostname/whoami/pwd) and only reports the asset as entered after verification succeeds.',
        parameters: {
          target: { type: 'string', required: true, description: 'Target asset IP or name, e.g. 203.0.113.101' },
        },
        output: { schema: RESULT_SCHEMA, render: renderResult },
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const bundle = bundleFor(exec, registry)
            const status = await bundle.manager.enter(args.target, exec.signal)
            return statusToValue(status)
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_assets',
        description:
          'List the assets (servers) your JumpServer account is authorized for, WITHOUT entering any of them: the connector sends the KoKo menu command "p" (strictly display-only), captures the on-screen list from the SAME PTY event stream the sidebar renders, parses it locally and optionally filters by a substring (case-insensitive, matched across name/ip/platform/node/comment) or by a configured system group (group="OA" OR-matches every keyword of the OA group, e.g. OA/portal/workflow/办公). Use this to answer "which OA servers exist?" or to discover targets before jumpserver_run/jumpserver_batch — NEVER guess IPs, and type no asset name back into the menu (KoKo auto-logs-in on a unique hit). Result includes KoKo footer verification fields (page/pageSize/totalPages/reportedTotal/complete): parsedRows == reportedTotal is the only proof the whole list was captured. refresh:true forces a fresh "p" capture instead of the per-conversation cache (failed captures are never cached, so refresh re-reads when a stale healthy cache exists). rawText is NOT included by default to keep context slim — pass includeRawText:true for diagnostics.',
        parameters: {
          filter: {
            type: 'string',
            description: 'Optional substring filter, e.g. "OA" or "203.0.113" — matched against asset name, IP and comment (case-insensitive)',
          },
          group: {
            type: 'string',
            description: 'Optional configured asset group name (exact, case-insensitive), e.g. "OA" or "ESB" — OR-matches the group keywords (assetGroups setting). Unknown groups error with INVALID_GROUP instead of returning "0 assets".',
          },
          refresh: {
            type: 'boolean',
            description: 'Force a fresh "p" capture instead of reusing the per-conversation cache (default false). Use after a failed/incomplete capture (ASSET_CAPTURE_TIMEOUT / ASSET_CAPTURE_INCOMPLETE / ASSET_PARSE_FAILED) to re-send "p" to KoKo.',
          },
          includeRawText: {
            type: 'boolean',
            description: 'Include the raw captured screen in rawText (default false, bounded). Off by default to save model context — rows are already structured.',
          },
        },
        output: { schema: ASSETS_SCHEMA, render: renderAssetsResult },
        timeoutMs: 45000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const bundle = bundleFor(exec, registry)
            const result = await bundle.manager.listAssets(
              typeof args.filter === 'string' ? args.filter : undefined,
              exec.signal,
              args.refresh === true,
              typeof args.group === 'string' ? args.group : undefined,
            )
            return assetsToValue(result, { includeRawText: args.includeRawText === true })
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_exec',
        description:
          'Execute one SIMPLE command on the CURRENTLY entered target asset for your conversation and return its stdout plus the real exit code (completion is detected with a unique marker, never by waiting a fixed time). Only works while the session is inside a verified asset shell. Read-only usage: send ONE simple read-only command (e.g. "free -m", "df -h", "tail -n 100 /var/log/app.log") — do NOT wrap several checks in for/if loops, \$(...) substitutions or multi-statement one-liners, because READ_ONLY mode classifies every command statically and blocks complex or mutating shell structure. For several checks on one target use jumpserver_batch with one simple command per entry. Subject to the configured permission mode: READ_ONLY blocks modifiers, AUTO/FULL_ACCESS ask for approval on modifying or dangerous commands.',
        parameters: {
          command: { type: 'string', required: true, description: 'Shell command to execute on the remote asset' },
          timeout: { type: 'number', description: 'Timeout in seconds for this command (default: configured command timeout, max 600)' },
        },
        output: { schema: RESULT_SCHEMA, render: renderResult },
        timeoutMs: 605000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const bundle = bundleFor(exec, registry)
            const services: GateServices = { getConfig, manager: bundle.manager, approval: ctx.get('approval') }
            const gated = await gateCommand(services, exec, args.command)
            const timeoutMs = args.timeout !== undefined ? Math.max(1, args.timeout) * 1000 : undefined
            const { status, outcome } = await bundle.manager.exec({
              command: args.command,
              timeoutMs,
              risk: gated.risk,
              classification: gated.classification,
              approvalRequired: gated.approvalRequired,
              approvalResult: gated.approvalRequired ? 'approved' : 'none',
              signal: exec.signal,
            })
            return execOutcomeToValue(status, outcome)
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_run',
        description:
          'Execute ONE SIMPLE command on a server reachable through the configured JumpServer, scoped to YOUR conversation. This tool automatically connects (or reuses THIS conversation\'s session), switches from the current asset when necessary, verifies the requested target, executes the command, and returns structured output. Prefer it for a single read-only diagnostic (e.g. "free -m", "df -h", "tail -n 200 /var/log/app.log", "ps -eo pid,user,%cpu,cmd --sort=-%cpu | head -15"). BATCHING CONTRACT: when you need MULTIPLE metrics on one target (CPU, memory, disk, processes, logs), do NOT call jumpserver_run repeatedly and do NOT wrap everything in for/if loops or long &&/; one-liners — READ_ONLY mode classifies each command as a whole and blocks complex or mutating shell structure. Instead call jumpserver_batch ONCE with a tasks entry whose commands array holds each simple read-only command as its own item (e.g. ["hostname", "uptime", "free -m", "df -h", "ps -eo pid,ppid,user,%cpu,%mem,cmd --sort=-%cpu | head -20", "tail -n 300 /var/log/app.log"]). The target is still entered ONCE for the whole list. For MULTIPLE targets, put each target in its own jumpserver_batch task. Use jumpserver_assets first when you do not know the exact target names/IPs.',
        parameters: {
          target: { type: 'string', required: true, description: 'Target asset IP or name, e.g. 203.0.113.101' },
          command: { type: 'string', required: true, description: 'Shell command to execute on the remote asset' },
          timeout: { type: 'number', description: 'Timeout in seconds for this command (default: configured command timeout, max 600)' },
        },
        output: { schema: RESULT_SCHEMA, render: renderResult },
        timeoutMs: 605000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const bundle = bundleFor(exec, registry)
            const services: GateServices = { getConfig, manager: bundle.manager, approval: ctx.get('approval') }
            const gated = await gateCommandForNavigation(services, exec, args.command)
            const timeoutMs = args.timeout !== undefined ? Math.max(1, args.timeout) * 1000 : undefined
            const result = await bundle.manager.run({
              target: args.target,
              command: args.command,
              timeoutMs,
              risk: gated.risk,
              classification: gated.classification,
              approvalRequired: gated.approvalRequired,
              approvalResult: gated.approvalRequired ? 'approved' : 'none',
              signal: exec.signal,
              beforeExec: gated.beforeExec,
            })
            const { target, hostname, status, outcome } = result
            const value = execOutcomeToValue(status, outcome)
            return { ...value, target, hostname }
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_batch',
        description:
          'Run a batch of SIMPLE commands across one or more targets through JumpServer in a single call, scoped to YOUR conversation. Each task lists a target plus the commands to run on it; the plugin enters a target ONCE, runs ALL of its commands, then leaves and moves to the next target (target affinity). Use this for multi-metric, multi-target diagnostics such as "check CPU/memory/disk/processes/logs on 203.0.113.101 and 203.0.113.102": ONE jumpserver_batch call with one task per target replaces many jumpserver_run calls. COMMAND STYLE (important in READ_ONLY mode): put ONE simple read-only command per commands[] entry (e.g. "hostname", "uptime", "free -m", "df -h", "ps -eo pid,ppid,user,%cpu,%mem,cmd --sort=-%cpu | head -20", "tail -n 300 /var/log/app.log"). Do NOT assemble shell programs (for/while loops, if branches, \$(...) command substitution, chained redirection) — each entry is classified independently and statically, so complex or mutating shell structure is blocked or flagged, while many small read-only entries all pass and stay debuggable. Commands run sequentially per target and are subject to the configured permission mode exactly like jumpserver_exec/jumpserver_run.',
        parameters: {
          tasks: {
            type: 'array',
            required: true,
            description:
              'One or more target tasks. Each task: { target: asset IP or name, commands: array of simple shell commands to run on that target, timeout: optional per-task seconds (default: configured command timeout, max 600) }. Keep every command a simple single-purpose read-only command (no for/if loops, no \$(...) substitution, no complex chaining) — each entry is permission-classified on its own. Never bounce between targets — all commands of one target run before the next target is entered.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                target: { type: 'string', required: true, description: 'Target asset IP or name, e.g. 203.0.113.101' },
                commands: {
                  type: 'array',
                  required: true,
                  description: 'Shell commands to execute on this target (run sequentially, results returned per command)',
                  items: { type: 'string' },
                },
                timeout: { type: 'number', description: 'Per-command timeout in seconds for this task (default: configured command timeout, max 600)' },
              },
            },
          },
        },
        output: { schema: RESULT_SCHEMA, render: renderResult },
        timeoutMs: 3600000,
        async execute(args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const bundle = bundleFor(exec, registry)
            const services: GateServices = { getConfig, manager: bundle.manager, approval: ctx.get('approval') }
            // args arrives as a JSON value; normalize defensively (the schema
            // already enforces shape before execute is reached).
            const rawTasks = Array.isArray(args.tasks) ? (args.tasks as unknown as Array<Record<string, unknown>>) : []
            const tasks = rawTasks.filter((t) => t !== null && typeof t === 'object')
            if (tasks.length === 0) {
              return { ok: false, code: 'INVALID_BATCH', message: 'jumpserver_batch requires at least one task with a target and commands' }
            }
            const executed: TargetBatchResult[] = []
            for (const task of tasks) {
              if (exec.signal.aborted === true) throw new AbortRequestedError()
              const target = String(task['target'] ?? '')
              const rawCommands = Array.isArray(task['commands']) ? (task['commands'] as unknown[]) : []
              const commands = rawCommands.map((c) => String(c ?? '')).filter((c: string) => c.trim().length > 0)
              if (target.length === 0) {
                executed.push({ target, hostname: null, error: { code: 'INVALID_BATCH', message: 'task target is missing' }, commands: [] })
                continue
              }
              if (commands.length === 0) {
                executed.push({ target, hostname: null, error: { code: 'INVALID_BATCH', message: 'task commands is empty' }, commands: [] })
                continue
              }
              // One task's failure (gating, navigation, execution) must not
              // discard other tasks' already-collected results: record the
              // error on that task and continue. Aborts still abort.
              try {
                // Gate every command up front; navigation-approval hooks run inside the batch turn.
                const gated = await Promise.all(
                  commands.map((command: string) => gateCommandForNavigation(services, exec, command)),
                )
                const taskTimeout = task['timeout']
                const timeoutMs = typeof taskTimeout === 'number' && Number.isFinite(taskTimeout) ? Math.max(1, taskTimeout) * 1000 : undefined
                const result = await bundle.manager.runTargetBatch({
                  target,
                  commands: gated.map((g, i) => ({
                    command: commands[i]!,
                    timeoutMs,
                    risk: g.risk,
                    classification: g.classification,
                    approvalRequired: g.approvalRequired,
                    approvalResult: g.approvalRequired ? 'approved' : 'none',
                    beforeExec: g.beforeExec,
                  })),
                  // P0: without the tool's abort signal the batch keeps
                  // driving the session (enter/exec/leave) after 停止生成;
                  // the manager checks request.signal on every step and
                  // session operations abort on it.
                  signal: exec.signal,
                })
                executed.push(result)
              } catch (error) {
                if (error instanceof AbortRequestedError || (exec.signal as { aborted?: boolean }).aborted === true) throw error
                executed.push({
                  target,
                  hostname: null,
                  error: thisJumpError(error),
                  commands: [],
                })
              }
            }
            return renderBatchResult(executed)
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_leave',
        description:
          'Leave the currently entered asset of YOUR conversation and return to the JumpServer menu. Sends exit at most once and only reports success after the JumpServer menu is detected again.',
        parameters: {},
        output: { schema: RESULT_SCHEMA, render: renderResult },
        async execute(_args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const bundle = bundleFor(exec, registry)
            const status = await bundle.manager.leave(exec.signal)
            return statusToValue(status)
          })
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'jumpserver_close',
        description:
          'Close YOUR conversation\'s JumpServer session: PTY, SSH channel/client, buffers and timers are released and the connector returns to the DISCONNECTED state. Other conversations are unaffected.',
        parameters: {},
        output: { schema: RESULT_SCHEMA, render: renderResult },
        async execute(_args, exec) {
          return guardValue(exec, async () => {
            const blocked = requireGrant(grants, exec)
            if (blocked !== null) return blocked
            const sessionId = sessionIdOf(exec)
            const bundle = bundleFor(exec, registry)
            if (terminateConversation !== undefined) await terminateConversation(sessionId)
            else { grants.revoke(sessionId); await bundle.manager.close() }
            return statusToValue(bundle.manager.status())
          })
        },
      }),
    ),
  )

  return disposers
}
