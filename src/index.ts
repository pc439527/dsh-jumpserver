import { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/cordis-plugin-timer'
import { createHash, randomUUID } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { Config } from './config/schema.js'
import type { JumpServerConfig } from './config/types.js'
import { SessionManager } from './jumpserver/session-manager.js'
import { SessionRegistry } from './jumpserver/session-registry.js'
import { SessionState } from './jumpserver/state-machine.js'
import { TerminalObserver } from './jumpserver/terminal-observer.js'
import { registerBridgeRoutes, type BridgeServices } from './bridge/bridge.js'
import { auditRecordSchema, nextAuditKey, toStructuredAuditRecord } from './security/audit.js'
import { registerJumpServerCommand } from './commands/grant-command.js'
import { jumpHostServices } from './commands/service-runtime.js'
import { SessionGrant } from './security/grant.js'
import { JUMPSERVER_SECTION_NAME, JUMPSERVER_SECTION_ORDER, JUMPSERVER_SOP } from './system-prompt.js'
import { registerJumpServerTools } from './tools/definitions.js'
import { registerOpsTools } from './tools/ops.js'
import { OpsCaseRegistry } from './ops/evidence.js'
import { manualPolicyOf } from './config/types.js'
import { classifyManual, manualGate, menuManualKind } from './security/manual-policy.js'

export const name = 'dsh-jumpserver'
export const inject = ['tools', 'timer', 'commands', 'systemPrompt'] as const
export { Config }
export type { JumpServerConfig as PluginConfig }

const JS_SETTINGS_NAMESPACE = 'jumpserver' as const

const JS_AUDIT_DOMAIN = defineDomain({
  name: 'jumpserver_audit',
  version: 1,
  tables: {
    audit: domainTable(auditRecordSchema),
  },
})

/**
 * One JumpServer PTY bundle per DSH conversation. Agent tool calls and the
 * sidebar mirror/manual input all resolve the same authoritative SessionId,
 * while different conversations never share manager/mutex/target/observer.
 */
export function apply(ctx: Context, config: JumpServerConfig): void {
  let source: () => Config = () => config
  let auditDomain: { close(): Promise<void> } | undefined
  let auditTable: { put(key: string, value: unknown): Promise<void> } | undefined

  const getConfig = (): Config => source()

  /**
   * Resolve password per connection; never cache or log it.
   * V0.3.1: an optional credential-ref (env name) override lets the bridge's
   * draft connection test resolve against the DRAFT passwordEnv instead of the
   * saved one; Agent flows call it with no argument (saved passwordEnv).
   */
  const resolvePassword = async (env?: string): Promise<string | undefined> => {
    const cfg = getConfig()
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      try {
        const hit = await credentials.resolve(credentialRef(env ?? cfg.passwordEnv))
        if (hit !== undefined && hit.value.length > 0) return hit.value
      } catch {
        /* credential resolution failure falls through to the literal */
      }
    }
    const literal = cfg.password
    return literal !== undefined && literal.length > 0 ? literal : undefined
  }

  // V0.2.4 P0: conversation-scoped Session Grant — the first permission boundary.
  const grants = new SessionGrant()
  // V0.3.0: per-conversation Ops Investigation cases (evidence ledger + report).
  const cases = new OpsCaseRegistry()
  // V0.2.7 P1: per-conversation recent-audit ring (last 200) for the sidebar audit tab.
  const recentAudits = new Map<string, Array<Record<string, unknown>>>()
  // V0.3.1 P1: one-time manual-confirmation challenges (single use, TTL).
  // A second request must present the SAME token + command hash — the host can
  // then prove the user actually saw the first confirm prompt.
  const confirmTokens = new Map<string, { token: string; commandHash: string; risk: string; expiresAt: number }>()
  const CONFIRM_TOKEN_TTL_MS = 120 * 1000

  const commandHashOf = (command: string): string => createHash('sha256').update(command).digest('hex').slice(0, 16)

  const registry = new SessionRegistry({
    create: (sessionId: string) => {
      const observer = new TerminalObserver(Math.max(500, getConfig().terminalScrollback))
      const manager = new SessionManager({
        getConfig,
        resolvePassword,
        observer,
        onAudit: (record) => {
          const ring = recentAudits.get(sessionId) ?? []
          ring.push(record as unknown as Record<string, unknown>)
          while (ring.length > 200) ring.shift()
          recentAudits.set(sessionId, ring)
          if (auditTable !== undefined) {
            return auditTable.put(nextAuditKey(record.timestamp), toStructuredAuditRecord(record))
          }
        },
        onLog: (message) => ctx.logger.debug('[jumpserver:' + sessionId + '] ' + message),
        scheduleTimeout: (fn, ms) => ctx.timer.timeout(fn, ms),
      })
      observer.recordState(SessionState.DISCONNECTED, null)
      return { manager, observer, lastUsedAt: Date.now() }
    },
    // V0.3.1 P2: a detached conversation must not leak session-attached Maps.
    onDetach: (sessionId) => {
      recentAudits.delete(sessionId)
      cases.deleteConversation(sessionId)
      confirmTokens.delete(sessionId)
      grants.revoke(sessionId)
    },
  })

  // Live settings seam; supports current provider API and the legacy helper.
  ctx.effect(
    async () => {
      const settings = (ctx as unknown as { get?: (name: string) => unknown }).get?.('settings') as
        | { installSection?: (...args: unknown[]) => void }
        | undefined
      const hooks = {
        setSource: (current: () => Config) => {
          source = current
        },
        onChange: () => {
          registry.applyScrollback(Math.max(200, source().terminalScrollback))
        },
      }
      if (settings !== undefined && typeof settings.installSection === 'function') {
        settings.installSection(ctx, JS_SETTINGS_NAMESPACE, Config, config, hooks)
        return () => undefined
      }
      try {
        const mod = (await import('@deepseek-ai/dsh-settings')) as unknown as {
          installSettingsSection?: (owner: Context, ns: string, schema: unknown, entry: JumpServerConfig, hk: typeof hooks) => void
        }
        if (typeof mod.installSettingsSection === 'function') {
          mod.installSettingsSection(ctx, JS_SETTINGS_NAMESPACE, Config, config, hooks)
          return () => undefined
        }
      } catch {
        /* provider-less deployment: keep the composition entry */
      }
      ctx.logger.warn('[jumpserver] no settings seam available; using composition config only')
      return () => undefined
    },
    'jumpserver: settings section',
  )

  // Audit sink via the DSH-native storage domain.
  ctx.effect(
    async () => {
      const facility = ctx.get('storageDomain')
      if (getConfig().enableAudit && facility !== undefined) {
        try {
          const domain = await facility.open(JS_AUDIT_DOMAIN)
          auditDomain = domain
          auditTable = domain.table('audit')
        } catch (error) {
          ctx.logger.warn('[jumpserver] audit storage unavailable: ' + String(error))
        }
      }
      return async () => {
        if (auditDomain !== undefined) {
          await auditDomain.close()
          auditDomain = undefined
          auditTable = undefined
        }
      }
    },
    'jumpserver.audit',
  )

  // Tool registration + idle maintenance are registry-scoped.
  ctx.effect(
    () => {
      const stopIdle = ctx.timer.interval(() => {
        registry.tickIdle()
        // A grant whose conversation bundle was detached must not linger.
        const live = new Set<string>(registry.snapshot().keys())
        for (const sessionId of grants.sessionIds()) {
          if (!live.has(sessionId)) grants.revoke(sessionId)
        }
      }, 30000)
      const cfgAtBoot = getConfig()
      ctx.logger.warn('[dsh-jumpserver] started: gateway=' + cfgAtBoot.host + ':' + cfgAtBoot.port + ' mode=' + cfgAtBoot.permissionMode)
      const disposers = registerJumpServerTools(ctx, registry, getConfig, grants)
      // V0.3.0: ops investigation tools (triage/compare/case/remediate) share the
      // same grant boundary and the per-conversation case registry.
      const opsDisposers = registerOpsTools(ctx, registry, getConfig, grants, cases)
      const disposeCommand = registerJumpServerCommand(ctx, registry, getConfig, grants)
      return () => {
        stopIdle()
        disposeCommand?.()
        for (const dispose of disposers) dispose()
        for (const dispose of opsDisposers) dispose()
        grants.revokeAll()
        registry.dispose()
      }
    },
    'jumpserver.session',
  )

  // V0.2.4 P0: the JumpServer Agent SOP — taught through the system-prompt
  // registry so the model knows when/how to use jumpserver_* (and never to
  // guess IPs or read an empty parse as "no assets").
  ctx.effect(
    () => {
      const services = jumpHostServices(ctx)
      if (services.systemPrompt !== undefined) {
        const disposeSection = services.systemPrompt.section({
          name: JUMPSERVER_SECTION_NAME,
          order: JUMPSERVER_SECTION_ORDER,
          text: JUMPSERVER_SOP,
        })
        return () => {
          try {
            disposeSection()
          } catch {
            /* already unregistered */
          }
        }
      }
      ctx.logger.warn('[jumpserver] systemPrompt service unavailable; agent SOP not injected')
      return () => undefined
    },
    'jumpserver.system-prompt',
  )

  const bridgeServices: BridgeServices = {
    getConfig,
    resolvePassword,
    grantedFor: (sessionId: string | undefined) => grants.isGranted(sessionId ?? ''),
    statusFor: (sessionId: string | undefined) => {
      const cfgNow = getConfig()
      const bundle = sessionId !== undefined ? registry.get(sessionId) : undefined
      const st = bundle !== undefined
        ? bundle.manager.status()
        : {
            state: SessionState.DISCONNECTED as SessionState,
            gateway: cfgNow.host + ':' + cfgNow.port,
            target: null,
            hostname: null,
            user: null,
            pwd: null,
            connectedAt: null,
            lastActivityAt: null,
            reconnectCount: 0,
            configured: Boolean(cfgNow.host && cfgNow.username),
            permissionMode: cfgNow.permissionMode,
          }
      const liveStates = new Set<string>([
        SessionState.JUMPSERVER_MENU,
        SessionState.ASSET_SHELL,
        SessionState.COMMAND_RUNNING,
        SessionState.ENTERING_ASSET,
      ])
      return {
        state: st.state,
        gateway: st.gateway,
        target: st.target,
        hostname: st.hostname,
        user: st.user,
        connected: liveStates.has(st.state),
        configured: st.configured,
        permissionMode: st.permissionMode,
        granted: grants.isGranted(sessionId ?? ''),
      }
    },
    observerFor: (sessionId: string | undefined) => {
      if (sessionId === undefined) return null
      return registry.get(sessionId)?.observer ?? null
    },
    auditFor: (sessionId: string | undefined) => {
      if (sessionId === undefined) return []
      return recentAudits.get(sessionId) ?? []
    },
    assetGroupNames: () => Object.keys(getConfig().assetGroups ?? {}),
    assetList: async (sessionId, opts) => {
      const bundle = registry.get(sessionId)
      if (bundle === undefined) return null
      bundle.lastUsedAt = Date.now()
      const result = await bundle.manager.listAssets(opts.filter, undefined, opts.refresh === true, opts.group)
      return {
        assets: result.assets.map((a) => ({ name: a.name, ip: a.ip, platform: a.platform, node: a.node })),
        count: result.count,
        reportedTotal: result.reportedTotal,
        complete: result.complete,
        health: result.health,
        filter: result.filter,
        group: result.group,
        groupMatched: result.groupMatched,
      }
    },
    manualExec: async (sessionId: string, command: string, signal?: AbortSignal, confirmed = false, confirmToken?: string) => {
      // Do not create a bundle from an arbitrary browser-provided id. Manual
      // input is available only after this conversation already owns a live
      // JumpServer session established through a model-facing tool call.
      const bundle = registry.get(sessionId)
      if (bundle === undefined) {
        return { ok: false, code: 'NO_SESSION', message: 'This conversation has no JumpServer session yet' }
      }
      bundle.lastUsedAt = Date.now()
      const st = bundle.manager.status()

      // V0.2.7 P1: state-aware manual input — JumpServer menu verbs first.
      if (st.state === SessionState.JUMPSERVER_MENU) {
        const kind = menuManualKind(command)
        if (kind === 'p') {
          try {
            const list = await bundle.manager.listAssets(undefined, signal)
            const rows = list.assets.slice(0, 200).map((a) => ({ name: a.name, ip: a.ip, platform: a.platform, node: a.node, comment: a.comment }))
            return { ok: true, kind: 'assets', state: st.state, count: list.count, reportedTotal: list.reportedTotal ?? list.parsedRows, health: list.health, rows, message: '菜单态：输入 IP 或主机名进入；q 关闭会话', sessionId }
          } catch (error) {
            return { ok: false, code: error instanceof Error && typeof (error as { code?: unknown }).code === 'string' ? String((error as { code?: string }).code) : 'MANUAL_FAILED', message: error instanceof Error ? error.message : String(error), sessionId }
          }
        }
        if (kind === 'q') {
          await bundle.manager.close()
          return { ok: true, kind: 'close', message: 'JumpServer 会话已关闭', sessionId }
        }
        if (kind === 'enter') {
          try {
            await bundle.manager.enter(command.trim(), signal)
            const after = bundle.manager.status()
            return { ok: true, kind: 'enter', state: after.state, target: after.target, hostname: after.hostname, sessionId }
          } catch (error) {
            return { ok: false, code: error instanceof Error && typeof (error as { code?: unknown }).code === 'string' ? String((error as { code?: string }).code) : 'MANUAL_FAILED', message: error instanceof Error ? error.message : String(error), sessionId }
          }
        }
        return {
          ok: false,
          code: 'MENU_INPUT_INVALID',
          message: '菜单态可用输入：p（列出资产）、IP 或主机名（进入）、q（关闭会话）',
          sessionId,
        }
      }

      if (st.state === SessionState.ASSET_SHELL) {
        // 'exit' is not a shell command: map it to the state-machine leave.
        if (command.trim() === 'exit') {
          try {
            await bundle.manager.leave(signal)
            return { ok: true, kind: 'leave', state: SessionState.JUMPSERVER_MENU, message: '已返回 JumpServer 菜单', sessionId }
          } catch (error) {
            return { ok: false, code: 'LEAVE_FAILED', message: error instanceof Error ? error.message : String(error), sessionId }
          }
        }
        // V0.2.7 P0: manual terminal permission policy.
        const classification = classifyManual(command)
        const risk = classification.risk
        const gate = manualGate(risk, manualPolicyOf(getConfig()), getConfig().permissionMode, confirmed)
        if (gate.kind === 'confirm' && !confirmed) {
          // V0.3.1 P1: one-time confirmation challenge — the second request must
          // prove it saw THIS prompt by echoing the issued token + command hash.
          const token = randomUUID()
          confirmTokens.set(sessionId, {
            token,
            commandHash: commandHashOf(command),
            risk,
            expiresAt: Date.now() + CONFIRM_TOKEN_TTL_MS,
          })
          return {
            ok: false,
            code: 'MANUAL_CONFIRM_REQUIRED',
            risk,
            command,
            confirmToken: token,
            commandHash: commandHashOf(command),
            expiresAt: Date.now() + CONFIRM_TOKEN_TTL_MS,
            state: st.state,
            message: '该命令需要二次确认，请核对后再次确认执行',
            sessionId,
          }
        }
        if (gate.kind === 'confirm' && confirmed) {
          // validate the challenge: same session, same command hash, same risk,
          // unexpired, single use — otherwise refuse (no execution).
          const challenge = confirmTokens.get(sessionId)
          if (challenge === undefined || challenge.expiresAt < Date.now()) {
            confirmTokens.delete(sessionId)
            return { ok: false, code: 'CONFIRMATION_EXPIRED', message: '确认已过期，请重新发起该命令', state: st.state, sessionId }
          }
          if (challenge.commandHash !== commandHashOf(command) || challenge.risk !== risk) {
            confirmTokens.delete(sessionId)
            return { ok: false, code: 'CONFIRMATION_MISMATCH', message: '确认内容与原始命令不一致，已拒绝执行', state: st.state, sessionId }
          }
          confirmTokens.delete(sessionId) // single use
        }
        if (gate.kind === 'block') {
          return { ok: false, code: 'MANUAL_BLOCKED', message: gate.reason, state: st.state, sessionId }
        }
        // execute — the CLASSIFIED risk is what the audit records (V0.3.1), so
        // the sidebar "只看修改" filter catches human modifications too; actor
        // is HUMAN to separate who ran it from what risk it carried.
        try {
          const { status, outcome } = await bundle.manager.exec({
            command,
            risk,
            actor: 'HUMAN',
            classification: {
              risk: classification.risk,
              reason: classification.reason,
              ruleId: classification.ruleId,
              confidence: classification.confidence,
              classifierVersion: classification.classifierVersion,
              normalizedCommand: classification.normalizedCommand,
            },
            signal,
          })
          if (outcome.kind === 'completed') {
            return {
              ok: true,
              kind: 'exec',
              state: status.state,
              target: status.target,
              hostname: status.hostname,
              executionState: outcome.executionState,
              exitCode: outcome.exitCode,
              durationMs: outcome.durationMs,
              sessionId,
            }
          }
          if (outcome.kind === 'timeout') {
            return {
              ok: false,
              kind: 'exec',
              code: 'COMMAND_TIMEOUT',
              message: outcome.executionState === 'TIMEOUT'
                ? 'manual command timed out; the shell was interrupted (Ctrl+C) and re-verified - it remains usable'
                : 'manual command timed out and the shell could NOT be re-verified; reconnect before continuing',
              state: status.state,
              target: status.target,
              hostname: status.hostname,
              executionState: outcome.executionState,
              durationMs: outcome.durationMs,
              sessionId,
            }
          }
          return {
            ok: false,
            kind: 'exec',
            code: 'CONNECTION_LOST',
            message: 'SSH connection lost during manual command execution',
            state: status.state,
            executionState: outcome.executionState,
            durationMs: outcome.durationMs,
            sessionId,
          }
        } catch (error) {
          const code = error instanceof Error && typeof (error as { code?: unknown }).code === 'string'
            ? String((error as { code?: string }).code)
            : 'MANUAL_EXEC_FAILED'
          return { ok: false, kind: 'exec', code, message: error instanceof Error ? error.message : String(error), sessionId }
        }
      }

      return { ok: false, code: 'NOT_NAVIGABLE', message: '会话状态 ' + st.state + ' 下无法执行人工输入（先连接并进入服务器）', state: st.state, sessionId }
    },
  }

  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.get('webServer')
    if (webServer === undefined) return
    webCtx.effect(() => registerBridgeRoutes(webServer, bridgeServices), 'jumpserver.bridge')
  })
}
