/**
 * JumpServer terminal rendered inside dsh-better-sidebar.
 *
 * Transport stays on the Host. The component is conversation-scoped via
 * scope.sessionId and consumes only redacted status/snapshot responses.
 * Explicit human commands are sent through a separate manual bridge route;
 * they use the same Host SessionManager/mutex/state machine/audit as Agent
 * commands. V0.2.7: state-aware manual input (menu verbs p/IP/name/q, exit ->
 * leave), an independent manual-terminal permission policy (CONFIRM_MODIFY
 * asks the user to confirm modifying commands), an asset picker + audit tab,
 * a slim single-line header with an info popover, and windowed row rendering.
 */
import * as React from 'react'
import { fetchAssets, fetchAudit, fetchSnapshot, fetchStatus, sendManualCommand, type StatusResponse } from './api.js'
import { applySnapshot, clearBuffer, createTerminalBuffer, setScrollback, type TerminalBuffer, type TerminalRow } from './terminal-view.js'
import { CLIENT_BUILD, CLIENT_VERSION } from './version.js'

const h = React.createElement

const ROW_H = 20
const OVERSCAN = 20

function followIcon(size = 14): React.ReactNode {
  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M8 2v8' }), h('path', { d: 'M5 7l3 3 3-3' }), h('path', { d: 'M2 14h12' }))
}

function clearIcon(size = 14): React.ReactNode {
  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M3 4h10' }), h('path', { d: 'M5.2 4l.5 8.2a1 1 0 0 0 1 .8h2.6a1 1 0 0 0 1-.8L10.8 4' }),
    h('path', { d: 'M6.5 6.5v4.6' }), h('path', { d: 'M9.5 6.5v4.6' }))
}

function sendIcon(size = 14): React.ReactNode {
  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: 'M2 8h10' }), h('path', { d: 'M9 4.5L12.5 8 9 11.5' }))
}

function infoIcon(size = 14): React.ReactNode {
  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('circle', { cx: 8, cy: 8, r: 6 }), h('path', { d: 'M8 7.2v3.3' }), h('path', { d: 'M8 5.2v.1' }))
}

export const TAB_ID = 'dsh-jumpserver:terminal'
export const TAB_ORDER = 45

export interface JumpServerSettingsScope {
  getSnapshot(): { status: string; writable: boolean; value?: Record<string, unknown>; base?: Record<string, unknown>; user?: Record<string, unknown>; revision?: number }
  subscribe(listener: () => void): () => void
}

export interface JumpServerSidebarTabProps {
  ctx: unknown
  scope: { sessionId: string; cwd?: string }
  tab: { id: string; type: string; title: string; path?: string; meta?: unknown }
  visible: boolean
  t: (key: string) => string
  settingsScope: JumpServerSettingsScope
}

interface StatusInfo {
  state?: string
  connected?: boolean
  enabled?: boolean
  configured?: boolean
  gateway?: string
  target?: string | null
  hostname?: string | null
  user?: string | null
  permissionMode?: string
  manualPolicy?: string
  granted?: boolean
  pluginVersion?: string
  hostBuild?: string
  protocolVersion?: number
}

const STATUS_TONE: Record<string, string> = {
  JUMPSERVER_MENU: 'connected', ASSET_SHELL: 'connected', COMMAND_RUNNING: 'busy',
  ENTERING_ASSET: 'busy', CONNECTING: 'busy', DISCONNECTED: 'error', UNKNOWN: 'error', ERROR: 'error',
}

function modeLabel(mode: string | undefined): string {
  switch (mode) {
    case 'READ_ONLY': return 'READ ONLY'
    case 'AUTO': return 'AUTO'
    case 'FULL_ACCESS': return 'FULL'
    default: return mode ?? '—'
  }
}

interface AssetRow {
  name?: string
  ip?: string | null
  platform?: string | null
  node?: string | null
}

function RowView({ row, line }: { row: TerminalRow; line: number }): React.ReactNode {
  if (row.kind === 'output') {
    return h('div', { className: 'js-term-output', key: line }, row.segments.map((segment, i) =>
      segment.cls !== null ? h('span', { key: i, className: segment.cls }, segment.text) : h('span', { key: i }, segment.text),
    ))
  }
  if (row.kind === 'input') {
    return h('div', { className: 'js-term-input', key: line },
      h('span', { className: 'js-term-prompt' }, '$'), h('span', null, row.text))
  }
  return h('div', { className: 'js-term-meta', 'data-kind': row.kind2, key: line }, row.text)
}

export function terminalIcon(size = 16): React.ReactNode {
  return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2 }), h('path', { d: 'M4.25 6l2 2-2 2' }), h('path', { d: 'M8.25 9.75h3.5' }))
}

export function JumpServerSidebarTab(props: JumpServerSidebarTabProps): React.ReactElement | null {
  const { visible, t, settingsScope, scope } = props
  const sessionId = scope?.sessionId ?? ''

  const [follow, setFollow] = React.useState(true)
  const [networkError, setNetworkError] = React.useState<string | null>(null)
  const [status, setStatus] = React.useState<StatusInfo>({})
  const [tab, setTab] = React.useState<'term' | 'assets' | 'audit'>('term')
  const [infoOpen, setInfoOpen] = React.useState(false)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [manualCommand, setManualCommand] = React.useState('')
  const [manualBusy, setManualBusy] = React.useState(false)
  const [manualError, setManualError] = React.useState<string | null>(null)
  const [confirmReq, setConfirmReq] = React.useState<{ command: string; risk?: string } | null>(null)
  const [windowStart, setWindowStart] = React.useState(0)
  const [viewportH, setViewportH] = React.useState(400)

  const [assets, setAssets] = React.useState<{ rows: AssetRow[]; groups: string[]; group: string; filter: string; count: number; loading: boolean; error: string | null }>({
    rows: [], groups: [], group: '', filter: '', count: 0, loading: false, error: null,
  })
  const [audit, setAudit] = React.useState<{ records: Array<Record<string, unknown>>; showFailed: boolean; showModify: boolean; loading: boolean }>({
    records: [], showFailed: false, showModify: false, loading: false,
  })

  const manualAbortRef = React.useRef<AbortController | null>(null)
  const bufferRef = React.useRef<TerminalBuffer | null>(null)
  const bufferSessionRef = React.useRef<string>('')
  const bodyRef = React.useRef<HTMLDivElement | null>(null)
  const [, forceRender] = React.useReducer((x: number) => x + 1, 0)

  const subscribed = React.useSyncExternalStore(
    React.useCallback((cb: () => void) => settingsScope.subscribe(cb), [settingsScope]),
    React.useCallback(() => settingsScope.getSnapshot(), [settingsScope]),
    React.useCallback(() => settingsScope.getSnapshot(), [settingsScope]),
  )
  const resolved = (subscribed?.value ?? {}) as Record<string, unknown>
  const scrollback = typeof resolved['terminalScrollback'] === 'number' ? Math.max(200, resolved['terminalScrollback'] as number) : 5000

  if (bufferRef.current === null || bufferSessionRef.current !== sessionId) {
    bufferRef.current = createTerminalBuffer(scrollback)
    bufferSessionRef.current = sessionId
  }
  const buffer = bufferRef.current

  React.useEffect(() => { setScrollback(buffer, scrollback) }, [scrollback, buffer])

  React.useEffect(() => {
    setStatus({}); setNetworkError(null); setManualCommand(''); setManualError(null); setConfirmReq(null); setTab('term')
    manualAbortRef.current?.abort(); manualAbortRef.current = null
    return () => { manualAbortRef.current?.abort(); manualAbortRef.current = null }
  }, [sessionId])

  const clear = React.useCallback(() => { clearBuffer(buffer); forceRender() }, [buffer])

  React.useEffect(() => {
    if (!visible || sessionId.length === 0) return
    let stopped = false
    let cursor = buffer.cursor
    let inflight: AbortController | null = null
    const statusController = new AbortController()
    fetchStatus(sessionId, statusController.signal).then((data: StatusResponse) => {
      if (!stopped) setStatus(data as unknown as StatusInfo)
    }).catch(() => undefined)
    const loop = async (): Promise<void> => {
      while (!stopped) {
        try {
          const controller = new AbortController()
          inflight = controller
          const data = await fetchSnapshot(cursor, sessionId, controller.signal)
          if (stopped) return
          setNetworkError(null)
          cursor = applySnapshot(buffer, data, cursor)
          setStatus(data as unknown as StatusInfo)
          forceRender()
        } catch (error) {
          if (stopped || (error instanceof Error && error.name === 'AbortError')) return
          setNetworkError(error instanceof Error ? error.message : String(error))
          await new Promise((resolve) => setTimeout(resolve, 3000))
        }
      }
    }
    void loop()
    return () => { stopped = true; statusController.abort(); inflight?.abort() }
  }, [visible, buffer, sessionId])

  // follow: keep the viewport pinned at the newest rows
  React.useEffect(() => {
    if (!follow) return
    const el = bodyRef.current as unknown as { scrollTop: number; scrollHeight: number; clientHeight: number } | null
    if (el !== null) {
      el.scrollTop = el.scrollHeight
      setWindowStart(Math.max(0, buffer.rows.length - Math.ceil((el.clientHeight ?? viewportH) / ROW_H)))
    }
  }, [follow, buffer.rows.length, viewportH])

  const scrollHandler = (event: { target?: { scrollTop?: number; clientHeight?: number } | null }): void => {
    const el = event.target
    if (el === null || el === undefined) return
    const st = Math.max(0, Math.floor((el.scrollTop ?? 0) / ROW_H) - OVERSCAN)
    const ch = Math.max(120, el.clientHeight ?? 0)
    setViewportH(ch)
    setWindowStart(st)
  }

  const tone = STATUS_TONE[status.state ?? ''] ?? 'connected'
  const statusLabel = status.enabled === false
    ? t('statusDisabled')
    : status.granted === false
      ? t('grantLocked')
      : status.connected ? t('statusConnected') : t('statusDisconnected')

  const hostVersion = status.pluginVersion
  const versionMismatch = hostVersion !== undefined && hostVersion !== CLIENT_VERSION
  const atMenu = status.state === 'JUMPSERVER_MENU'
  const atShell = status.state === 'ASSET_SHELL'
  const manualAvailable = (atMenu || atShell) && !manualBusy && sessionId.length > 0
  const manualPlaceholder = !manualAvailable
    ? t('manualUnavailable')
    : atMenu
      ? '[Host]> 输入 IP / 主机名 / p'
      : status.hostname !== null && status.hostname !== undefined ? '[' + String(status.hostname) + ' ~]# '
      : '[root@host ~]# '

  const submitManual = React.useCallback(async (commandInput?: string, confirmed = false): Promise<void> => {
    const command = (commandInput ?? manualCommand).trim()
    if (!manualAvailable && !confirmed) return
    if (!manualAvailable && confirmed) setManualBusy(true)
    if (manualAvailable) setManualBusy(true)
    setManualError(null)
    setConfirmReq(null)
    const controller = new AbortController()
    manualAbortRef.current?.abort()
    manualAbortRef.current = controller
    try {
      const result = await sendManualCommand(sessionId, command, controller.signal, confirmed)
      if (result.ok !== true) {
        if (result.code === 'MANUAL_CONFIRM_REQUIRED') {
          setConfirmReq({ command, risk: result.risk })
          setManualCommand('')
          return
        }
        setManualError(result.message ?? result.code ?? t('manualFailed'))
        return
      }
      setManualCommand('')
      if (result.kind === 'assets') { setNotice('资产列表：' + String(result.count ?? 0) + ' 台'); setTab('assets'); setAssets((prev) => ({ ...prev, rows: (result.rows ?? []) as AssetRow[], count: result.count ?? prev.count })) }
      else if (result.kind === 'enter') { setTab('term'); setNotice('已进入服务器 ' + String(result.target ?? '')) }
      else if (result.kind === 'leave') { setNotice('已返回 JumpServer 菜单'); setTab('term'); void refreshAssets() }
      else if (result.kind === 'close') { setNotice('JumpServer 会话已关闭') }
      if (result.state !== undefined) setStatus((prev) => ({ ...prev, state: result.state }))
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        setManualError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      if (manualAbortRef.current === controller) manualAbortRef.current = null
      setManualBusy(false)
    }
  }, [manualAvailable, manualCommand, sessionId, t])

  const refreshAssets = React.useCallback(async (): Promise<void> => {
    if (sessionId.length === 0) return
    setAssets((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const data = await fetchAssets(sessionId, { filter: undefined, group: undefined, refresh: true })
      if (data.ok !== true) {
        setAssets((prev) => ({ ...prev, loading: false, error: data.message ?? data.code ?? '无法获取资产列表' }))
        return
      }
      setAssets((prev) => ({
        ...prev,
        loading: false,
        rows: data.rows ?? [],
        groups: data.groups ?? [],
        count: data.count ?? 0,
        error: data.health === 'ok' || data.health === undefined ? null : '资产健康度: ' + String(data.health ?? '?'),
      }))
    } catch (error) {
      setAssets((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : String(error) }))
    }
  }, [sessionId])

  const openAssetsTab = React.useCallback((): void => {
    setTab('assets')
    void refreshAssets()
  }, [refreshAssets])

  const openAuditTab = React.useCallback((): void => {
    setTab('audit')
    if (audit.records.length === 0) void refreshAudit()
  }, [audit.records.length])

  const refreshAudit = React.useCallback(async (): Promise<void> => {
    if (sessionId.length === 0) return
    setAudit((prev) => ({ ...prev, loading: true }))
    try {
      const data = await fetchAudit(sessionId)
      setAudit((prev) => ({ ...prev, loading: false, records: data.records ?? [] }))
    } catch (error) {
      setAudit((prev) => ({ ...prev, loading: false, records: [] }))
    }
  }, [sessionId])

  const searchAssets = (term: string): void => {
    setAssets((prev) => ({ ...prev, filter: term }))
  }
  const pickGroup = (group: string): void => {
    setAssets((prev) => ({ ...prev, group, filter: '' }))
    setAssets((prev) => ({ ...prev, loading: true }))
    void (async () => {
      try {
        const data = await fetchAssets(sessionId, { group: group.length > 0 ? group : undefined, refresh: true })
        if (data.ok === true) {
          setAssets((prev) => ({ ...prev, loading: false, rows: data.rows ?? [], count: data.count ?? 0, error: null, groups: data.groups ?? prev.groups }))
        } else {
          setAssets((prev) => ({ ...prev, loading: false, error: data.message ?? data.code ?? '分组查询失败' }))
        }
      } catch (error) {
        setAssets((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : String(error) }))
      }
    })()
  }

  const filteredAssets = assets.rows.filter((a) => {
    const term = assets.filter.trim().toLowerCase()
    if (term.length === 0) return true
    return [a.name ?? '', a.ip ?? '', a.node ?? '', a.platform ?? ''].join(' ').toLowerCase().includes(term)
  })

  const enterAsset = (row: AssetRow): void => {
    const target = (row.ip ?? row.name ?? '').trim()
    if (target.length === 0) return
    setManualCommand(target)
    setManualBusy(true)
    setManualError(null)
    void (async () => {
      try {
        const result = await sendManualCommand(sessionId, target, undefined)
        if (result.ok === true) { setTab('term'); setManualCommand(''); void refreshAssets() }
        else setManualError(result.message ?? result.code ?? t('manualFailed'))
      } catch (error) {
        setManualError(error instanceof Error ? error.message : String(error))
      } finally {
        setManualBusy(false)
      }
    })()
  }

  const copyToClipboard = (text: string): void => {
    const clip = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<unknown> } } }).navigator?.clipboard
    clip?.writeText?.(text)?.catch(() => undefined)
  }

  const auditFiltered = audit.records.filter((r) => {
    const risk = String(r['risk'] ?? '')
    const result = String(r['result'] ?? '')
    const exit = r['exitCode']
    if (audit.showFailed) {
      const failed = result !== 'ok' && result !== 'COMPLETED' || (typeof exit === 'number' && exit !== 0)
      if (!failed) return false
    }
    if (audit.showModify && risk !== 'MODIFY' && risk !== 'DANGEROUS') return false
    return true
  })

  const fmtTime = (value: unknown): string => {
    const s = String(value ?? '')
    return s.length > 19 ? s.slice(11, 19) : s
  }

  const auditRows = auditFiltered.slice(0, 150).map((r, i) =>
    h('div', { className: 'js-term-auditRow', key: i },
      h('span', { className: 'js-term-auditTime' }, fmtTime(r['timestamp'])),
      h('span', { className: 'js-term-auditWho' }, [String(r['actor'] ?? ''), String(r['operation'] ?? 'exec')].filter(Boolean).join(' ')),
      h('span', { className: 'js-term-auditRisk' + (String(r['risk'] ?? '') === 'MODIFY' || String(r['risk'] ?? '') === 'DANGEROUS' ? ' js-term-warn' : '') }, String(r['risk'] ?? '')),
      h('span', { className: 'js-term-auditTarget' }, String(r['target'] ?? '?')),
      h('span', { className: 'js-term-auditCmd' }, String(r['command'] ?? '')),
      h('span', { className: 'js-term-auditMeta' }, 'rc=' + String(r['exitCode'] ?? '?') + ' ' + String(r['durationMs'] ?? '?') + 'ms'),
    ),
  )

  const assetRows = filteredAssets.slice(0, 150).map((a, i) =>
    h('button', {
      type: 'button', className: 'js-term-assetItem', key: i,
      title: '点击进入 ' + String(a.name ?? a.ip ?? ''),
      onClick: () => enterAsset(a),
    },
      h('span', { className: 'js-term-assetIp' }, a.ip ?? a.name ?? '?'),
      h('span', { className: 'js-term-assetName' }, a.name ?? ''),
      h('span', { className: 'js-term-assetMeta' }, [a.platform, a.node].filter((v) => v !== null && v !== undefined).join(' · ')),
      h('span', { className: 'js-term-assetGo' }, '›'),
    ),
  )

  const visibleTotal = buffer.rows.length
  const windowEnd = Math.min(visibleTotal, windowStart + Math.ceil(viewportH / ROW_H) + OVERSCAN * 2)
  const visibleRows = buffer.rows.slice(windowStart, windowEnd)

  return h('div', { className: 'js-term-pane', role: 'region', 'aria-label': t('tabTitle') },
    h('div', { className: 'js-term-header' },
      h('span', { className: 'js-term-dot', 'data-state': tone }),
      h('div', { className: 'js-term-chips' },
        h('span', { className: 'js-term-status', 'data-tone': tone }, statusLabel),
        h('span', { className: 'js-term-chip' }, status.target !== null && status.target !== undefined
          ? String(status.target) + (status.hostname ? ' / ' + String(status.hostname) : '')
          : '[堡垒机]'),
        h('span', { className: 'js-term-chip' }, modeLabel(status.permissionMode)),
        h('span', { className: 'js-term-chip', title: t('grantTooltip') }, status.granted === true ? '🔓' : '🔒'),
        hostVersion !== undefined
          ? h('span', { className: 'js-term-chip js-term-version', title: 'Host ' + hostVersion + '@' + String(status.hostBuild ?? '?') + ' · Client ' + CLIENT_VERSION + '@' + CLIENT_BUILD }, 'v' + hostVersion)
          : null,
      ),
      versionMismatch
        ? h('span', { className: 'js-term-chip js-term-warn', role: 'status' }, '⚠ Host ' + String(hostVersion) + ' / Client ' + CLIENT_VERSION + ' — 请重启 dsh web')
        : null,
      h('button', { type: 'button', className: 'js-term-iconBtn', 'aria-label': 'info', title: '连接与版本详情', onClick: () => setInfoOpen(!infoOpen) }, infoIcon(14)),
    ),
    infoOpen
      ? h('div', { className: 'js-term-infoPop', role: 'tooltip' },
          h('div', null, 'Gateway: ' + String(status.gateway ?? '—')),
          h('div', null, 'User: ' + String(status.user ?? '—')),
          h('div', null, 'Manual: ' + String(status.manualPolicy ?? '—')),
          h('div', null, 'Host ' + String(hostVersion ?? '?') + '@' + String(status.hostBuild ?? '?') + ' protocol ' + String(status.protocolVersion ?? '?')),
          h('div', null, 'Client ' + CLIENT_VERSION + '@' + CLIENT_BUILD),
        )
      : null,
    notice !== null ? h('div', { className: 'js-term-manualError', role: 'status', onClick: () => setNotice(null) }, notice) : null,
    h('div', { className: 'js-term-tabs' },
      h('button', { type: 'button', className: 'js-term-tab' + (tab === 'term' ? ' js-term-tabActive' : ''), onClick: () => setTab('term') }, '终端'),
      h('button', { type: 'button', className: 'js-term-tab' + (tab === 'assets' ? ' js-term-tabActive' : ''), onClick: openAssetsTab }, '资产'),
      h('button', { type: 'button', className: 'js-term-tab' + (tab === 'audit' ? ' js-term-tabActive' : ''), onClick: openAuditTab }, '审计'),
    ),
    tab === 'assets'
      ? h('div', { className: 'js-term-assets' },
          h('div', { className: 'js-term-searchRow' },
            h('input', {
              type: 'text', className: 'js-term-search', value: assets.filter, placeholder: '搜索 IP / 主机名 / 系统',
              onChange: (event: { target?: { value?: string } | null }) => searchAssets(event.target?.value ?? ''),
            }),
            h('button', { type: 'button', className: 'js-term-iconBtn', title: '刷新', onClick: () => void refreshAssets() }, '↻'),
          ),
          h('div', { className: 'js-term-groups' },
            h('button', { type: 'button', className: 'js-term-chip js-term-groupChip' + (assets.group === '' ? ' js-term-chipActive' : ''), onClick: () => pickGroup('') }, '全部'),
            assets.groups.map((g) => h('button', { type: 'button', key: g, className: 'js-term-chip js-term-groupChip' + (assets.group === g ? ' js-term-chipActive' : ''), onClick: () => pickGroup(g) }, g)),
          ),
          assets.error !== null ? h('div', { className: 'js-term-manualError', role: 'status' }, assets.error) : null,
          assets.loading ? h('div', { className: 'js-term-empty' }, '加载中…') : (
            filteredAssets.length === 0
              ? h('div', { className: 'js-term-empty' }, '无匹配资产（在堡垒机菜单态可用）')
              : h('div', { className: 'js-term-assetList' },
                  h('div', { className: 'js-term-assetMeta' }, '显示 ' + filteredAssets.length + ' / ' + String(assets.count)),
                  assetRows,
                )
          ),
        )
      : tab === 'audit'
        ? h('div', { className: 'js-term-audit' },
            h('div', { className: 'js-term-searchRow' },
              h('label', { className: 'js-term-auditFilter' }, h('input', { type: 'checkbox', checked: audit.showFailed, onChange: (e: { target?: { checked?: boolean } | null }) => setAudit({ ...audit, showFailed: e.target?.checked === true }) }), '只看失败'),
              h('label', { className: 'js-term-auditFilter' }, h('input', { type: 'checkbox', checked: audit.showModify, onChange: (e: { target?: { checked?: boolean } | null }) => setAudit({ ...audit, showModify: e.target?.checked === true }) }), '只看修改'),
              h('button', { type: 'button', className: 'js-term-iconBtn', title: '复制过滤结果', onClick: () => copyToClipboard(auditFiltered.map((r) => [fmtTime(r['timestamp']), String(r['actor'] ?? ''), String(r['operation'] ?? ''), String(r['risk'] ?? ''), String(r['target'] ?? ''), String(r['command'] ?? ''), 'rc=' + String(r['exitCode'] ?? '?')].join(' ')).join(String.fromCharCode(10))),
 }, '⧉'),
              h('button', { type: 'button', className: 'js-term-iconBtn', title: '刷新', onClick: () => void refreshAudit() }, '↻'),
            ),
            audit.loading ? h('div', { className: 'js-term-empty' }, '加载中…') : (
              auditRows.length === 0 ? h('div', { className: 'js-term-empty' }, '暂无审计记录') : h('div', { className: 'js-term-auditList' }, auditRows)
            ),
          )
        : h('div', { className: 'js-term-body', ref: bodyRef, onScroll: scrollHandler },
            buffer.rows.length === 0
              ? h('div', { className: 'js-term-empty' }, t('emptyTerminal'))
              : h('div', { className: 'js-term-window', style: { height: visibleTotal * ROW_H + 'px' } },
                  h('div', { style: { transform: 'translateY(' + windowStart * ROW_H + 'px)' } }, visibleRows.map((row, index) => h(RowView, { row, key: row.id, line: windowStart + index }))),
                ),
          ),
    h('div', { className: 'js-term-manual' },
      h('span', { className: 'js-term-manualPrompt', 'aria-hidden': true }, atMenu ? '[Host]>' : '$'),
      h('input', {
        className: 'js-term-manualInput', type: 'text', value: manualCommand, disabled: !manualAvailable,
        autoComplete: 'off', spellCheck: false, placeholder: manualPlaceholder, 'aria-label': manualPlaceholder,
        onChange: (event: { target?: { value?: string } | null }) => { setManualCommand(event.target?.value ?? ''); setManualError(null) },
        onKeyDown: (event: { key: string; shiftKey?: boolean; preventDefault(): void }) => {
          if (event.key === 'Enter' && event.shiftKey !== true) { event.preventDefault(); void submitManual() }
        },
      }),
      h('button', { type: 'button', className: 'js-term-iconBtn js-term-sendBtn', disabled: !manualAvailable || manualCommand.trim().length === 0, title: manualBusy ? t('manualSending') : t('manualSend'), 'aria-label': manualBusy ? t('manualSending') : t('manualSend'), onClick: () => void submitManual() }, sendIcon(14)),
    ),
    confirmReq !== null
      ? h('div', { className: 'js-term-confirm', role: 'alertdialog' },
          h('div', { className: 'js-term-confirmText' }, '修改命令需要二次确认 (' + String(confirmReq.risk ?? 'MODIFY') + ')：' + confirmReq.command),
          h('div', { className: 'js-term-confirmActions' },
            h('button', { type: 'button', className: 'js-term-btn js-term-btnDanger', onClick: () => { manualAbortRef.current?.abort(); setConfirmReq(null); setManualError(null) } }, '取消'),
            h('button', { type: 'button', className: 'js-term-btn js-term-btnPrimary', onClick: () => { const cmd = confirmReq.command; setConfirmReq(null); void submitManual(cmd, true) } }, '确认执行'),
          ),
        )
      : null,
    manualError !== null ? h('div', { className: 'js-term-manualError', role: 'status' }, manualError) : null,
    h('div', { className: 'js-term-footer' },
      h('div', { className: 'js-term-footerMeta' },
        h('span', { className: 'js-term-status', 'data-tone': tone }, statusLabel),
        networkError !== null ? h('span', { className: 'js-term-testErr' }, networkError) : h('span', { className: 'js-term-hint' }, atMenu ? 'p=资产 · IP/名称=进入 · q=关闭' : t('manualHint')),
      ),
      h('div', { className: 'js-term-actions' },
        h('button', { type: 'button', className: 'js-term-iconBtn', 'data-active': follow || undefined, 'aria-pressed': follow, 'aria-label': t('followTooltip'), title: t('followTooltip'), onClick: () => setFollow(!follow) }, followIcon(14)),
        h('button', { type: 'button', className: 'js-term-iconBtn', 'aria-label': t('clearTooltip'), title: t('clearTooltip'), onClick: clear }, clearIcon(14)),
      ),
    ),
  )
}
