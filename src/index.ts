import { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/cordis-plugin-timer'
import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
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
import { setConsoleUrlResolver } from './tools/common.js'
import { hostBuild } from './version.js'
import { registerOpsTools } from './tools/ops.js'
import { registerJobTools } from './tools/jobs.js'
import { registerCollectionTools } from './tools/inspection.js'
import { JobStore } from './runtime/job-store.js'
import { BaselineStore } from './runtime/baseline-store.js'
import { jumpHomeBaselines, jumpHomeBootMarker, jumpHomeClientTrace, jumpHomeConsole, jumpHomeKnownHosts } from './runtime/paths.js'
import { interruptSession } from './runtime/interrupt.js'
import { DEFAULT_CONSOLE_PORT, startConsoleServer, type ConsoleHandle } from './runtime/console.js'
import { OpsCaseRegistry } from './ops/evidence.js'
import { manualPolicyOf, resolveConcurrency, resolveConnection } from './config/types.js'
import { Semaphore } from './jumpserver/concurrency.js'
import { requireTargetAllowed } from './security/target-scope.js'
import { classifyManual, manualGate, menuManualKind } from './security/manual-policy.js'

export const name = 'dsh-jumpserver'
/**
 * ONLY services the base composition always mounts.
 *
 * V0.4.1: an unsatisfied inject is not an error — cordis simply never activates
 * the entry, which looked exactly like "the plugin is installed but does
 * nothing". `commands` / `systemPrompt` are therefore resolved through
 * `ctx.get` by jumpHostServices(), which degrades (no /jumpserver command, no
 * SOP section) instead of blocking the whole plugin.
 */
export const inject = ['tools', 'timer'] as const
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
/** Best-effort discovery write: never let a state file break activation. */
function writeStateFile(target: string, body: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, JSON.stringify({ ...body, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
  } catch {
    /* the plugin must load even when its state directory is not writable */
  }
}

export function apply(ctx: Context, config: JumpServerConfig): void {
  // V0.4.1: written BEFORE anything else can fail. If this file never appears
  // after a restart, the Host half did not activate at all — a fact that
  // separates "not mounted" from "mounted but the console failed".
  // A phase trace, not just a boot flag: if apply() aborts halfway, the last
  // step recorded says exactly where, and any caught failure carries its
  // message. Diagnosing "it is installed but does nothing" cost several
  // restart cycles without this.
  const trace: string[] = []
  const failures: string[] = []
  const mark = (step: string): void => {
    trace.push(step)
    writeStateFile(jumpHomeBootMarker(), { pid: process.pid, hostBuild: hostBuild(), steps: trace, failures })
  }
  const safe = (step: string, fn: () => void): void => {
    try {
      fn()
    } catch (error) {
      failures.push(step + ': ' + (error instanceof Error ? error.message : String(error)))
      writeStateFile(jumpHomeBootMarker(), { pid: process.pid, hostBuild: hostBuild(), steps: trace, failures })
    }
  }
  writeStateFile(jumpHomeBootMarker(), { pid: process.pid, hostBuild: hostBuild(), startedAt: new Date().toISOString(), steps: ['boot'], failures })
  let source: () => Config = () => config
  let auditDomain: { close(): Promise<void> } | undefined
  let auditTable: { put(key: string, value: unknown): Promise<void> } | undefined

  // DSH Host configuration is the single source of connection settings. Every
  // reader must use this projection so status, settings views and the actual
  // SSH identity can never disagree.
  const effectiveConfig = (): Config => source()

  // V0.5.0/V0.5.11: the effective connection is resolved per call so a
  // settings change (or a different selected profile) takes effect on the next
  // connect without restarting the Host. The profile wins field by field.
  const getConfig = (): Config => {
    const cfg = effectiveConfig()
    const conn = resolveConnection(cfg)
    const knownHostsPath = typeof cfg.knownHostsPath === 'string' && cfg.knownHostsPath.length > 0
      ? cfg.knownHostsPath
      : jumpHomeKnownHosts()
    return { ...cfg, host: conn.host, port: conn.port, username: conn.username, passwordEnv: conn.passwordEnv, knownHostsPath }
  }

  /** Where the live identity comes from (never the value itself). */
  const connectionSource = (): { source: string; profileId?: string; profileLabel?: string } => {
    const conn = resolveConnection(effectiveConfig())
    return {
      source: conn.source,
      ...(conn.profileId !== undefined ? { profileId: conn.profileId } : {}),
      ...(conn.profileLabel !== undefined ? { profileLabel: conn.profileLabel } : {}),
    }
  }

  // V0.4.1: one process-wide session-pool cap (maxSessions). A single
  // conversation still owns exactly one PTY; this only bounds how many may be
  // inside an asset at once. A changed value applies after the Host restarts.
  const sessionGate = new Semaphore(resolveConcurrency(getConfig()).maxSessions)

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
        sessionGate,
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

  // V0.4.0: streaming jobs (tail -f / journalctl -f / tcpdump) own the PTY
  // until stopped; output is harvested from the conversation's observer.
  mark('settings:done')
  const jobs = new JobStore(registry)
  // V0.4.1: every tool result carries the console URL once the console binds.
  setConsoleUrlResolver((sessionId) => consoleUrlFor(sessionId))
  // V0.4.0: the loopback console URL of a conversation. Assigned once the
  // console has actually bound its port; before that (and when disabled) the
  // accessor returns undefined and jumpserver_status simply omits the field.
  let consoleUrlFor: (sessionId: string) => string | undefined = () => undefined
  // V0.4.1: named baseline snapshots for drift detection.
  const baselines = new BaselineStore(jumpHomeBaselines())

  /** One authoritative end-and-lock lifecycle for every explicit close path. */
  const terminateConversationJumpServer = async (sessionId: string) => {
    grants.revoke(sessionId)
    confirmTokens.delete(sessionId)
    const bundle = registry.get(sessionId)
    if (bundle === undefined) return null
    return bundle.manager.close()
  }

  // DSH 0.2.x settings: the Loader already publishes this entry's Config under
  // its profile entry id, so the plugin only has to (a) allow the UI to
  // auto-generate a page for this instance and (b) react to live edits.
  //
  // The previous installSection()/installSettingsSection() calls were a 0.1-era
  // API: neither exists in @deepseek-ai/dsh-settings 0.2.x, so both branches
  // silently no-op'd, the namespace was never served, and the settings card
  // never mounted - with no error anywhere.
  ctx.effect(
    () => {
      mark('settings:start')
      const settings = (ctx as unknown as { get?: (name: string) => unknown }).get?.('settings') as
        | {
            configure?: (presentation: { auto?: boolean }, owner?: unknown) => () => void
            describe?: () => Array<{ ns?: string; autoGenerate?: boolean }>
          }
        | undefined
      if (settings === undefined) {
        mark('settings:absent')
        ctx.logger.warn('[jumpserver] no settings service on this Host; configuration is composition-only')
        return () => undefined
      }
      const dispose = typeof settings.configure === 'function' ? settings.configure({ auto: true }, ctx) : undefined
      mark('settings:configured')
      try {
        const served = (typeof settings.describe === 'function' ? settings.describe() : []).map((d) => String(d.ns ?? ''))
        mark('settings:namespaces:' + served.join(','))
        mark(served.includes(JS_SETTINGS_NAMESPACE) ? 'settings:namespace-ok' : 'settings:namespace-missing')
      } catch (error) {
        mark('settings:describe-failed')
      }
      // describe() skips an entry whose fiber is not yet active (state !== 2),
      // so a probe taken inside apply() can be a false negative. Re-probe once
      // this fiber is certainly active to tell "not served" from "not yet".
      const late = setTimeout(() => {
        try {
          const served = (typeof settings.describe === 'function' ? settings.describe() : []).map((d) => String(d.ns ?? ''))
          mark('late:namespaces:' + served.join(','))
          mark(served.includes(JS_SETTINGS_NAMESPACE) ? 'late:namespace-ok' : 'late:namespace-missing')
        } catch {
          mark('late:describe-failed')
        }
      }, 5000)
      if (typeof late === 'object' && late !== null && 'unref' in late) late.unref()
      // The served namespaces are exactly the config-editor entry ids, so dump
      // those too: it distinguishes "entry absent" from "entry under another id".
      try {
        const editor = (ctx as unknown as { get?: (n: string) => unknown }).get?.('configEditor') as
          | { entries?: () => Array<{ options?: { id?: string; name?: string } }> }
          | undefined
        const rows = (typeof editor?.entries === 'function' ? editor.entries() : [])
          .map((e) => String(e.options?.id ?? '?') + '(' + String(e.options?.name ?? '?') + ')')
        mark('entries:' + rows.join(','))
        mark(rows.some((row) => row.startsWith(JS_SETTINGS_NAMESPACE + '(')) ? 'entry:found' : 'entry:absent')
      } catch (error) {
        mark('entries:failed')
        ctx.logger.warn('[jumpserver] settings.describe() failed: ' + String(error))
      }
      return () => {
        try {
          dispose?.()
        } catch {
          /* policy already released */
        }
      }
    },
    'jumpserver: settings page policy',
  )

  // Live edits: re-budget the terminal observers when the operator changes it.
  ctx.effect(
    () => {
      const settings = (ctx as unknown as { get?: (name: string) => unknown }).get?.('settings') as
        | { subscribe?: (listener: () => void) => () => void }
        | undefined
      const off = typeof settings?.subscribe === 'function' ? settings.subscribe(() => {
        registry.applyScrollback(Math.max(200, getConfig().terminalScrollback))
      }) : undefined
      return () => { try { off?.() } catch { /* already disposed */ } }
    },
    'jumpserver: settings live updates',
  )

  // Audit sink via the DSH-native storage domain.
  ctx.effect(
    async () => {
      mark('audit:start')
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
      mark('tools:start')
      // JobStore owns its own unref'd 1 s pump timer (ensureTimer) — the plugin
      // must not run a second one.
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
      // Each group is registered inside its own guard: the real ctx.tools.register
      // VALIDATES a tool definition and throws on a bad schema (the mock context used
      // by the local smoke does not), so one rejected tool used to abort the whole
      // plugin — no tools, no console, and no error anyone could see.
      const disposers: Array<() => void> = []
      const opsDisposers: Array<() => void> = []
      const jobDisposers: Array<() => void> = []
      const collectDisposers: Array<() => void> = []
      let disposeCommand: (() => void) | null | undefined
      mark('tools:core')
      safe('tools:core', () => {
        disposers.push(...registerJumpServerTools(
          ctx,
          registry,
          getConfig,
          grants,
          terminateConversationJumpServer,
          (sessionId) => recentAudits.get(sessionId) ?? [],
          (sessionId) => consoleUrlFor(sessionId),
        ))
      })
      mark('tools:ops')
      safe('tools:ops', () => { opsDisposers.push(...registerOpsTools(ctx, registry, getConfig, grants, cases)) })
      mark('tools:jobs')
      safe('tools:jobs', () => { jobDisposers.push(...registerJobTools(ctx, registry, getConfig, grants, jobs)) })
      mark('tools:collect')
      safe('tools:collect', () => { collectDisposers.push(...registerCollectionTools(ctx, registry, getConfig, grants, baselines)) })
      mark('tools:command')
      safe('tools:command', () => { disposeCommand = registerJumpServerCommand(ctx, registry, getConfig, grants, terminateConversationJumpServer) })
      return () => {
        jobs.dispose()
        stopIdle()
        disposeCommand?.()
        for (const dispose of disposers) dispose()
        for (const dispose of opsDisposers) dispose()
        for (const dispose of jobDisposers) dispose()
        for (const dispose of collectDisposers) dispose()
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
      mark('prompt:start')
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
    terminateFor: terminateConversationJumpServer,
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
        connectionSource: connectionSource(),
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
          await terminateConversationJumpServer(sessionId)
          return { ok: true, kind: 'close', message: 'JumpServer 已结束并锁定', state: SessionState.DISCONNECTED, connected: false, sessionId, granted: false }
        }
        if (kind === 'enter') {
          try {
            // V0.4.2: a denied / out-of-scope target never gets navigated to.
            requireTargetAllowed(getConfig(), command.trim())
            await bundle.manager.enter(command.trim(), undefined, signal)
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
          if (confirmToken === undefined || challenge.token !== confirmToken || challenge.commandHash !== commandHashOf(command) || challenge.risk !== risk) {
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
    consoleUrlFor: (sessionId) => (sessionId === undefined || sessionId.length === 0 ? consoleUrlFor('') : consoleUrlFor(sessionId)),
    diagFor: (event, detail) => {
      try {
        appendFileSync(jumpHomeClientTrace(), JSON.stringify({ at: new Date().toISOString(), event, detail }) + '\n', 'utf8')
      } catch {
        /* telemetry must never break the plugin */
      }
    },
    // V0.4.5: the sidebar's 任务/中断 buttons go through the SAME entry points as
    // the tools, so the UI can never interrupt a job twice or reach another
    // conversation's job.
    jobsFor: async (sessionId) =>
      jobs.list(sessionId).map((job) => ({
        id: job.id,
        target: job.target,
        hostname: job.hostname,
        command: job.command,
        state: job.state,
        startedAt: job.startedAt,
        stoppedAt: job.stoppedAt,
        bytes: job.bytes,
        truncated: job.truncated,
        error: job.error,
      })),
    jobStopFor: async (sessionId, jobId) => {
      if (jobs.get(jobId, sessionId) === null) {
        return { ok: false, code: 'UNKNOWN_JOB', message: 'no job with id ' + jobId + ' in this conversation', jobId }
      }
      const job = await jobs.stop(jobId, 'sidebar', sessionId)
      return { ok: job.state === 'STOPPED', jobId: job.id, jobState: job.state, target: job.target, error: job.error, sessionId }
    },
    interruptFor: async (sessionId) => {
      const bundle = registry.get(sessionId)
      if (bundle === undefined) return { ok: false, code: 'NO_SESSION', message: 'this conversation has no JumpServer session', sessionId }
      const result = await interruptSession(jobs, bundle.manager, sessionId)
      return { ...result, ok: result.sent, sessionId }
    },
  }

  // Desktop 0.2.x: the loopback console. It needs no webServer route, so it
  // starts whenever the plugin does; the native sidebarRight Browser Tab that
  // opens it is independent of the console's own lifetime.
  ctx.effect(
    () => {
      mark('console:start')
      if (getConfig().consoleEnabled === false) { mark('console:disabled'); return () => undefined }
      let disposed = false
      let handle: ConsoleHandle | undefined
      void startConsoleServer(bridgeServices, { port: getConfig().consolePort ?? DEFAULT_CONSOLE_PORT })
        .then((started) => {
          if (disposed) {
            void started.close()
            return
          }
          handle = started
          mark('console:bound:' + String(started.port))
          consoleUrlFor = (sessionId: string) => started.urlFor(sessionId)
          // The token never leaves Host memory and the HttpOnly cookie.
          writeStateFile(jumpHomeConsole(), { port: started.port, url: started.urlFor(undefined) })
          ctx.logger.warn('[dsh-jumpserver] console: ' + started.urlFor(undefined))
        })
        .catch((error) => {
          failures.push('console: ' + (error instanceof Error ? error.message : String(error)))
          mark('console:failed')
          ctx.logger.warn('[dsh-jumpserver] console unavailable: ' + String(error))
        })
      return () => {
        disposed = true
        consoleUrlFor = () => undefined
        void handle?.close()
      }
    },
    'jumpserver.console',
  )

  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.get('webServer')
    if (webServer === undefined) return
    webCtx.effect(() => registerBridgeRoutes(webServer, bridgeServices), 'jumpserver.bridge')
  })
}
