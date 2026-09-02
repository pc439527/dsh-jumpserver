/**
 * The /jumpserver slash command (V0.2.4 P0): the ONLY way a conversation
 * receives a JumpServer Session Grant.
 *
 * Semantics:
 *   /jumpserver <task text>  -> ARMED_FOR_TURN: grant armed, task forwarded to
 *                               the agent via Agent.followup(), and the grant
 *                               auto-locks when that turn settles (agent idle)
 *                               or after the hard TTL, whichever comes first.
 *   /jumpserver on            -> persistent grant until /jumpserver off (or
 *                               session teardown/plugin dispose).
 *   /jumpserver (bare)        -> HELP ONLY, grants nothing (V0.2.5: a single
 *                               stray command must never unlock JumpServer).
 *   /jumpserver status        -> grant mode + live session state.
 *   /jumpserver off           -> revoke grant, close this conversation PTY,
 *                                clear the asset cache (human manual input then
 *                                has no live session to type into).
 *
 * The command is dispatched directly by the UI (never sent to the model), keyed
 * to the receiving agent session — the same id the jumpserver_* tools use.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { JumpServerConfig } from '../config/types.js'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionRegistry } from '../jumpserver/session-registry.js'
import { DEFAULT_TURN_GRANT_TTL_MS, type SessionGrant } from '../security/grant.js'
import { jumpHostServices, type CommandAgentLike } from './service-runtime.js'
import type { CommandResult } from './service-types.js'

function sessionIdOfAgent(agent: CommandAgentLike): string {
  const id = agent.session?.header?.id
  return typeof id === 'string' && id.length > 0 ? id : agent.id
}

/**
 * Auto-lock a turn-scoped grant: when the agent's status flips back to
 * "idle" after this followup turn (or when the hard TTL elapses), revoke
 * the grant. The listener is registered on the AGENT-scoped context so it
 * only ever observes this conversation's transitions.
 */
function armTurnRelock(ctx: Context, agent: CommandAgentLike, sessionId: string, grants: SessionGrant): void {
  let settled = false
  let cleanup: (() => void) | undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  const settle = (): void => {
    if (settled) return
    settled = true
    if (cleanup !== undefined) try { cleanup() } catch { /* already removed */ }
    if (timer !== null) clearTimeout(timer)
    grants.revoke(sessionId)
    ctx.logger?.debug?.('[jumpserver] turn-scoped grant for ' + sessionId + ' auto-locked')
  }
  try {
    cleanup = agent.ctx.on('agent/status', (payload: unknown) => {
      const p = payload as { agent?: { id?: unknown }; status?: string } | null | undefined
      if (p?.agent?.id !== sessionId) return
      if (p.status === 'idle') settle()
    })
  } catch {
    cleanup = undefined // events unavailable: the hard TTL still relocks
  }
  timer = setTimeout(() => settle(), DEFAULT_TURN_GRANT_TTL_MS)
}

/**
 * Register /jumpserver. Returns the commands-service disposer so the plugin
 * can unregister on teardown. The commands service is optional in the host:
 * without it the plugin logs and continues (tools stay grant-locked).
 */
export function registerJumpServerCommand(
  ctx: Context,
  registry: SessionRegistry,
  getConfig: () => JumpServerConfig,
  grants: SessionGrant,
): (() => void) | null {
  const services = jumpHostServices(ctx)
  if (services.commands === undefined) {
    ctx.logger.warn?.('[jumpserver] commands service unavailable; /jumpserver is not registered')
    return null
  }
  return services.commands.register({
    name: 'jumpserver',
    description:
      'Authorize THIS conversation to use JumpServer (jumpserver_* tools). With a task, arms the grant for one turn and sends the task to the agent; "on" grants persistently until "off"; "off" revokes the grant and closes the SSH session; "status" shows the current grant and session state. A bare command only shows help and grants nothing.',
    input: { hint: 'on | off | status | <task text>' },
    handler: async (invocation): Promise<CommandResult> => {
      const agent = invocation.agent
      const sessionId = sessionIdOfAgent(agent)
      const rawTask = invocation.rawInput.trim()
      const lower = rawTask.toLowerCase()

      if (lower === 'off' || lower === 'close') {
        grants.revoke(sessionId)
        const bundle = registry.get(sessionId)
        if (bundle !== undefined) {
          await bundle.manager.close().catch(() => undefined) // close also drops the asset cache
        }
        return { kind: 'success', text: 'JumpServer 已撤销授权并关闭本对话的 SSH 会话（资产缓存已清空）。需要时再发 /jumpserver <任务> 单轮授权。' }
      }

      if (lower === 'status') {
        const granted = grants.isGranted(sessionId)
        const mode = grants.modeOf(sessionId)
        const bundle = registry.get(sessionId)
        let state = 'no-session'
        let target: string | null = null
        let hostname: string | null = null
        if (bundle !== undefined) {
          const st = bundle.manager.status()
          state = st.state
          target = st.target
          hostname = st.hostname
        }
        const grantedText = granted
          ? mode === 'turn' ? 'ARMED (turn-scoped, 本轮)' : 'ARMED (persistent, 直到 /jumpserver off)'
          : 'LOCKED'
        return {
          kind: 'success',
          text:
            'JumpServer 状态\n  grant: ' + grantedText + '\n  state: ' + state +
            (target !== null ? '\n  target: ' + target : '') +
            (hostname !== null ? '\n  hostname: ' + hostname : ''),
        }
      }

      if (rawTask.length === 0) {
        // V0.2.5: bare /jumpserver only shows help — it must NOT silently arm
        // a persistent grant. A user who merely typed the command once should
        // never unintentionally unlock JumpServer for a long time.
        return {
          kind: 'success',
          text:
            'JumpServer 命令用法：\n' +
            '  /jumpserver <任务>   单轮授权并把任务交给 Agent（本轮结束自动锁回）\n' +
            '  /jumpserver on       持续授权，直到 /jumpserver off\n' +
            '  /jumpserver status   查看授权与会话状态\n' +
            '  /jumpserver off      撤销授权并关闭 SSH 会话\n' +
            '裸命令只显示帮助，不授权；请明确使用 on 或直接写任务。',
        }
      }

      if (lower === 'on') {
        grants.arm(sessionId, 'persistent')
        // Authorization is also the user's explicit request to make the human
        // sidebar usable. Start the conversation-dedicated SSH session now;
        // previously it stayed disconnected until an Agent tool happened to
        // call connect(), which made /jumpserver on appear ineffective.
        const bundle = registry.getOrCreate(sessionId)
        void bundle.manager.connect(invocation.signal).catch((error) => {
          ctx.logger.warn?.('[jumpserver] authorized but initial connection failed: ' +
            (error instanceof Error ? error.message : String(error)))
        })
        return {
          kind: 'success',
          text: '已为本对话持续授权 JumpServer，正在连接右侧终端；执行 /jumpserver off 撤销授权并关闭会话。',
        }
      }

      // Real task: single-turn grant + dispatch to the agent.
      grants.arm(sessionId, 'turn')
      armTurnRelock(ctx, agent, sessionId, grants)
      try {
        const message = createUserMessage({
          content: [{ type: 'text', text: rawTask }],
          source: { kind: 'user' },
        })
        agent.followup(message)
      } catch (error) {
        grants.revoke(sessionId)
        return { kind: 'error', text: '无法把任务交给 Agent（已撤销本轮的 JumpServer 授权）：' + (error instanceof Error ? error.message : String(error)) }
      }
      const preview = rawTask.length > 120 ? rawTask.slice(0, 117) + '...' : rawTask
      return {
        kind: 'success',
        text:
          '已为本轮授权 JumpServer，任务已经交给 Agent：\n“' + preview + '”\n' +
          '本轮结束（或 30 分钟上限）后自动锁回。再需要时就再发 /jumpserver <任务>。',
      }
    },
  })
}
