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
import { fetchAssets, fetchAudit, fetchSnapshot, fetchStatus, sendManualCommand, terminateJumpServer, type StatusResponse } from './api.js'
import { applySnapshot, clearBuffer, createTerminalBuffer, setScrollback, type TerminalBuffer, type TerminalRow } from './terminal-view.js'
import { downloadAudit } from './audit-export.js'
import { CLIENT_BUILD, CLIENT_VERSION } from './version.js'

const h = React.createElement

/** Isomorphic layout effect: calibrate before paint in the browser, no-op
 *  (plain effect) under SSR so the sidebar-tab render tests stay clean. */
const useIsoLayoutEffect = typeof (globalThis as { window?: unknown }).window !== 'undefined' ? React.useLayoutEffect : React.useEffect

const ROW_H = 20
const OVERSCAN = 20
const AUDIT_TIME_ZONE = 'Asia/Shanghai'

type AuditFilter = 'ALL' | 'READ' | 'UNKNOWN' | 'MODIFY' | 'DANGEROUS' | 'FAILED'

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

export function formatAuditTime(value: unknown): string {
  const raw = String(value ?? '')
  const date = new Date(raw)
  if (!Number.isNaN(date.getTime())) {
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        timeZone: AUDIT_TIME_ZONE,
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).format(date)
    } catch {
      // Older browser/embedded runtimes: preserve the old readable fallback.
    }
  }
  return raw.length > 19 ? raw.slice(11, 19) : raw
}

function auditEventType(record: Record<string, unknown>): string {
  const explicit = String(record['eventType'] ?? '').trim()
  if (explicit.length > 0) return explicit
  switch (String(record['operation'] ?? '')) {
    case 'exec':
    case 'run':
    case 'run-batch-cmd': return 'COMMAND'
    case 'list-assets': return 'ASSET_LIST'
    case 'enter': return 'ASSET_ENTER'
    case 'leave': return 'ASSET_LEAVE'
    case 'close': return 'DISCONNECT'
    case 'connect': return 'CONNECT'
    default: return 'EVENT'
  }
}

function auditEventLabel(record: Record<string, unknown>): string {
  switch (auditEventType(record)) {
    case 'ASSET_LIST': return '刷新资产列表'
    case 'ASSET_ENTER': return '进入资产'
    case 'ASSET_LEAVE': return '返回堡垒机'
    case 'CONNECT': return '连接 JumpServer'
    case 'DISCONNECT': return '关闭 JumpServer'
    default: return String(record['operation'] ?? '系统事件')
  }
}

function auditFailed(record: Record<string, unknown>): boolean {
  const result = String(record['result'] ?? '')
  const exit = record['exitCode']
  return (result !== 'ok' && result !== 'COMPLETED' && result !== 'ASSET_LIST_EMPTY') || (typeof exit === 'number' && exit !== 0)
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
  const [confirmReq, setConfirmReq] = React.useState<{ command: string; risk?: string; confirmToken?: string; commandHash?: string; expiresAt?: number } | null>(null)
  const [windowStart, setWindowStart] = React.useState(0)
  const [viewportH, setViewportH] = React.useState(400)
  const [newOutput, setNewOutput] = React.useState(0)

  const [assets, setAssets] = React.useState<{ rows: AssetRow[]; groups: string[]; group: string; node: string; filter: string; count: number; loading: boolean; error: string | null; fetchedAt: number | null }>({
    rows: [], groups: [], group: '', node: '', filter: '', count: 0, loading: false, error: null, fetchedAt: null,
  })
  const [audit, setAudit] = React.useState<{ records: Array<Record<string, unknown>>; filter: AuditFilter; search: string; loading: boolean }>({
    records: [], filter: 'ALL', search: '', loading: false,
  })

  const manualAbortRef = React.useRef<AbortController | null>(null)
  const bufferRef = React.useRef<TerminalBuffer | null>(null)
  const bufferSessionRef = React.useRef<string>('')
  const bodyRef = React.useRef<HTMLDivElement | null>(null)
  const [, forceRender] = React.useReducer((x: number) => x + 1, 0)
  const followRef = React.useRef(true)
  const savedScrollTopRef = React.useRef(0)
  const lastRowsRef = React.useRef(0)
  const assetsGroupRef = React.useRef('')

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

  const clear = React.useCallback(() => {
    clearBuffer(buffer)
    setNewOutput(0)
    setWindowStart(0)
    savedScrollTopRef.current = 0
    lastRowsRef.current = 0
    forceRender()
  }, [buffer])

  React.useEffect(() => {
    if (!visible || sessionId.length === 0) return
    let stopped = false
    let cursor = buffer.cursor
    let inflight: AbortController | null = null
    const statusController = new AbortController()
    fetchStatus(sessionId, statusController.signal).then((data: StatusResponse) => {
      if (!stopped) setStatus(data as unknown as StatusInfo)
    }).catch(() => undefined)
    lastRowsRef.current = buffer.rows.length
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
          const grown = buffer.rows.length - lastRowsRef.current
          lastRowsRef.current = buffer.rows.length
          if (grown > 0 && !followRef.current) setNewOutput((n) => n + grown)
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

  React.useEffect(() => {
    followRef.current = follow
    if (!follow) return
    setNewOutput(0)
    const el = bodyRef.current as unknown as { scrollTop: number; scrollHeight: number; clientHeight: number } | null
    if (el !== null) {
      el.scrollTop = el.scrollHeight
      setWindowStart(Math.max(0, buffer.rows.length - Math.ceil((el.clientHeight ?? viewportH) / ROW_H)))
    }
  }, [follow, buffer.rows.length, viewportH])

  const scrollHandler = (event: { target?: { scrollTop?: number; scrollHeight?: number; clientHeight?: number } | null }): void => {
    const el = event.target
    if (el === null || el === undefined) return
    const st = Math.max(0, Math.floor((el.scrollTop ?? 0) / ROW_H) - OVERSCAN)
    const ch = Math.max(120, el.clientHeight ?? 0)
    setViewportH(ch)
    setWindowStart(st)
    savedScrollTopRef.current = el.scrollTop ?? 0
    const distanceToBottom = (el.scrollHeight ?? 0) - (el.scrollTop ?? 0) - (el.clientHeight ?? 0)
    if (distanceToBottom <= 24 && !followRef.current) {
      setFollow(true)
      setNewOutput(0)
    } else if (distanceToBottom > 24 && followRef.current) {
      setFollow(false)
    }
  }

  const termActive = tab === 'term' && visible
  useIsoLayoutEffect(() => {
    if (!termActive) return
    const el = bodyRef.current as unknown as { scrollTop: number; scrollHeight: number; clientHeight: number } | null
    if (el === null) return
    if (followRef.current) {
      el.scrollTop = el.scrollHeight
      const ch = Math.max(120, el.clientHeight || viewportH)
      if (ch !== viewportH) setViewportH(ch)
      setWindowStart(Math.max(0, buffer.rows.length - Math.ceil(ch / ROW_H)))
    } else {
      const restore = Math.min(Math.max(0, savedScrollTopRef.current), (el.scrollHeight || 0) - (el.clientHeight || 0))
      el.scrollTop = restore
      setWindowStart(Math.max(0, Math.floor(restore / ROW_H) - OVERSCAN))
    }
  }, [termActive, buffer, follow])

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
      ? '输入 IP / 主机名（p 查看资产）'
      : status.hostname !== null && status.hostname !== undefined ? '[' + String(status.hostname) + ' ~]# '
      : '[root@host ~]# '

  const submitManual = React.useCallback(async (commandInput?: string, confirmed = false, confirmToken?: string): Promise<void> => {
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
      const result = await sendManualCommand(sessionId, command, controller.signal, confirmed, confirmToken ?? confirmReq?.confirmToken)
      if (result.ok !== true) {
        if (result.code === 'MANUAL_CONFIRM_REQUIRED' && !confirmed) {
          setConfirmReq({ command, risk: result.risk, confirmToken: result.confirmToken, commandHash: result.commandHash, expiresAt: result.expiresAt })
          setManualCommand('')
          return
        }
        setManualError(result.message ?? result.code ?? t('manualFailed'))
        return
      }
      setManualCommand('')
      if (result.kind === 'assets') { setNotice('资产列表：' + String(result.count ?? 0) + ' 台'); setTab('assets'); setAssets((prev) => ({ ...prev, rows: (result.rows ?? []) as AssetRow[], count: result.count ?? prev.count, fetchedAt: Date.now() })) }
      else if (result.kind === 'enter') { setTab('term'); setNotice('已进入服务器 ' + String(result.target ?? '')) }
      else if (result.kind === 'leave') { setNotice('已返回 JumpServer 菜单'); setTab('term'); void loadAssets(false, assetsGroupRef.current) }
      else if (result.kind === 'close') { setNotice('JumpServer 已结束并锁定'); setStatus((prev) => ({ ...prev, state: 'DISCONNECTED', connected: false, granted: false })) }
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

  const endAndLock = React.useCallback(async (): Promise<void> => {
    if (sessionId.length === 0) return
    try {
      const result = await terminateJumpServer(sessionId) as StatusResponse & { code?: string; message?: string }
      if (result.ok === false) throw new Error(result.message ?? result.code ?? '结束失败')
      setConfirmReq(null)
      setNotice('JumpServer 已结束并锁定；重新使用需要 /jumpserver on 或 /jumpserver <任务>')
      setStatus((prev) => ({ ...prev, state: 'DISCONNECTED', connected: false, granted: false, target: null, hostname: null }))
    } catch (error) {
      setManualError(error instanceof Error ? error.message : String(error))
    }
  }, [sessionId])

  const loadAssets = React.useCallback(async (force: boolean, group?: string): Promise<void> => {
    if (sessionId.length === 0) return
    if (group !== undefined) assetsGroupRef.current = group
    setAssets((prev) => ({ ...prev, loading: true }))
    try {
      const data = await fetchAssets(sessionId, { filter: undefined, group: (assetsGroupRef.current.length > 0 ? assetsGroupRef.current : undefined), refresh: force })
      if (data.ok !== true) {
        setAssets((prev) => ({
          ...prev,
          loading: false,
          error: (data.message ?? data.code ?? '无法获取资产列表') + (prev.fetchedAt !== null && prev.rows.length > 0 ? '；仍显示上次成功获取的结果' : ''),
        }))
        return
      }
      setAssets((prev) => ({
        ...prev,
        loading: false,
        rows: data.rows ?? [],
        groups: data.groups ?? prev.groups,
        group: assetsGroupRef.current,
        node: '',
        filter: '',
        count: data.count ?? 0,
        fetchedAt: Date.now(),
        error: data.health === 'ok' || data.health === undefined ? null : '资产健康度: ' + String(data.health ?? '?'),
      }))
    } catch (error) {
      setAssets((prev) => ({
        ...prev,
        loading: false,
        error: (error instanceof Error ? error.message : String(error)) + (prev.fetchedAt !== null && prev.rows.length > 0 ? '；仍显示上次成功获取的结果' : ''),
      }))
    }
  }, [sessionId])

  const refreshAssets = React.useCallback((): void => {
    void loadAssets(true)
  }, [loadAssets])

  const openAssetsTab = React.useCallback((): void => {
    setTab('assets')
    if (assets.rows.length === 0) void loadAssets(false)
  }, [assets.rows.length, loadAssets])

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
    setAssets((prev) => ({ ...prev, group, node: '', filter: '' }))
    void loadAssets(false, group)
  }
  const pickNode = (node: string): void => {
    setAssetWinStart(0)
    setAssets((prev) => ({ ...prev, node }))
  }

  const nodeGroups = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of assets.rows) {
      const node = String(row.node ?? '').trim()
      if (node.length === 0) continue
      counts.set(node, (counts.get(node) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12)
  }, [assets.rows])

  const filteredAssets = assets.rows.filter((a) => {
    if (assets.node.length > 0 && String(a.node ?? '') !== assets.node) return false
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
        if (result.ok === true) { setTab('term'); setManualCommand('') }
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
    const eventType = auditEventType(r)
    if (audit.filter === 'FAILED' && !auditFailed(r)) return false
    if (audit.filter === 'MODIFY' && risk !== 'MODIFY' && risk !== 'DANGEROUS') return false
    if (audit.filter !== 'ALL' && audit.filter !== 'FAILED' && audit.filter !== 'MODIFY' && risk !== audit.filter) return false
    if (audit.filter !== 'ALL' && audit.filter !== 'FAILED' && eventType !== 'COMMAND') return false
    const term = audit.search.trim().toLowerCase()
    if (term.length > 0) {
      const haystack = [
        r['actor'], r['operation'], r['eventType'], r['risk'], r['target'], r['hostname'],
        r['redactedCommand'] ?? r['command'], r['result'], r['riskRuleId'], r['riskReason'],
      ].map((v) => String(v ?? '')).join(' ').toLowerCase()
      if (!haystack.includes(term)) return false
    }
    return true
  })

  const auditCounts = audit.records.reduce<Record<string, number>>((acc, record) => {
    if (auditEventType(record) === 'COMMAND') {
      const risk = String(record['risk'] ?? 'UNKNOWN')
      acc[risk] = (acc[risk] ?? 0) + 1
    } else {
      acc['EVENT'] = (acc['EVENT'] ?? 0) + 1
    }
    if (auditFailed(record)) acc['FAILED'] = (acc['FAILED'] ?? 0) + 1
    return acc
  }, {})

  const fmtTime = formatAuditTime

  const [expandedAudit, setExpandedAudit] = React.useState<string | null>(null)
  const auditRows = auditFiltered.map((r, i) => {
    const eventType = auditEventType(r)
    const isCommand = eventType === 'COMMAND'
    const riskStr = String(r['risk'] ?? '')
    const warn = riskStr === 'MODIFY' || riskStr === 'DANGEROUS' || riskStr === 'UNKNOWN'
    const key = String(r['timestamp'] ?? i) + ':' + String(i)
    const expanded = expandedAudit === key
    const rule = String(r['riskRuleId'] ?? '')
    const reason = String(r['riskReason'] ?? '')
    const conf = String(r['riskConfidence'] ?? '')
    const v = Number(r['classifierVersion'] ?? 0)
    const approval = String(r['approvalResult'] ?? 'none')
    const displayCommand = isCommand ? String(r['redactedCommand'] ?? r['command'] ?? '') : auditEventLabel(r)
    const target = String(r['target'] ?? r['hostname'] ?? '—')
    const result = String(r['result'] ?? '—')
    return h('div', { className: 'js-term-auditRow', key, onClick: () => setExpandedAudit(expanded ? null : key), title: expanded ? undefined : (isCommand && rule.length > 0 ? rule + ' · ' + reason : '点击查看详情') },
      h('span', { className: 'js-term-auditTime', title: String(r['timestamp'] ?? '') }, fmtTime(r['timestamp'])),
      h('span', { className: 'js-term-auditWho' }, [String(r['actor'] ?? ''), isCommand ? String(r['operation'] ?? 'exec') : 'EVENT'].filter(Boolean).join(' ')),
      isCommand
        ? h('span', { className: 'js-term-auditRisk' + (warn ? ' js-term-warn' : ''), 'data-risk': riskStr }, riskStr)
        : h('span', { className: 'js-term-auditEventBadge' }, 'EVENT'),
      h('span', { className: 'js-term-auditTarget', title: target }, target),
      h('span', { className: 'js-term-auditCmd', title: displayCommand }, displayCommand),
      h('span', { className: 'js-term-auditMeta' }, isCommand
        ? 'rc=' + String(r['exitCode'] ?? '?') + ' ' + String(r['durationMs'] ?? '?') + 'ms'
        : result + (r['durationMs'] !== null && r['durationMs'] !== undefined ? ' · ' + String(r['durationMs']) + 'ms' : '')),
      expanded
        ? h('div', { className: 'js-term-auditDetail' },
            isCommand
              ? h(React.Fragment, null,
                  h('div', null, 'Rule: ' + (rule.length > 0 ? rule : '—') + ' · confidence ' + (conf.length > 0 ? conf : '—') + (v > 0 ? ' · classifier v' + String(v) : '')),
                  h('div', null, 'Reason: ' + (riskStr === 'UNKNOWN' ? '无法确认只读；' : riskStr === 'MODIFY' ? '已确认修改服务器状态；' : '') + (reason.length > 0 ? reason : '—')),
                  h('div', null, 'Target: ' + String(r['target'] ?? '?') + ' · Hostname: ' + String(r['hostname'] ?? '?') + ' · Permission: ' + String(r['permissionMode'] ?? '?')),
                  h('div', null, 'Approval: ' + approval + (r['approvalRequired'] === true ? ' (required)' : '') + ' · Result: ' + result),
                  h('div', null, 'Normalized: ' + String(r['normalizedRedactedCommand'] ?? r['normalizedCommand'] ?? displayCommand)),
                )
              : h(React.Fragment, null,
                  h('div', null, 'Event: ' + auditEventLabel(r) + ' · type ' + eventType),
                  h('div', null, 'Result: ' + result + (r['durationMs'] !== null && r['durationMs'] !== undefined ? ' · Duration: ' + String(r['durationMs']) + 'ms' : '')),
                  h('div', null, 'Target: ' + String(r['target'] ?? '—') + ' · Hostname: ' + String(r['hostname'] ?? '—') + ' · Permission: ' + String(r['permissionMode'] ?? '?')),
                  r['redactedCommand'] !== undefined && r['redactedCommand'] !== null ? h('div', null, 'Detail: ' + String(r['redactedCommand'])) : null,
                ),
          )
        : null,
    )
  })

  const ASSET_ROW_H = 48
  const [assetWinStart, setAssetWinStart] = React.useState(0)
  const [assetWinH, setAssetWinH] = React.useState(360)
  const assetWinEnd = Math.min(filteredAssets.length, assetWinStart + Math.ceil(assetWinH / ASSET_ROW_H) + OVERSCAN * 2)
  const assetScroll = (event: { target?: { scrollTop?: number; clientHeight?: number } | null }): void => {
    const el = event.target
    if (el === null || el === undefined) return
    const ch = Math.max(120, el.clientHeight ?? 0)
    const st = Math.max(0, Math.floor((el.scrollTop ?? 0) / ASSET_ROW_H) - OVERSCAN)
    setAssetWinH(ch)
    setAssetWinStart(st)
  }
  const assetRows = filteredAssets.slice(assetWinStart, assetWinEnd).map((a, i) => {
    const unsupportedWindows = String(a.platform ?? '').toLowerCase() === 'windows'
    return h('button', {
      type: 'button', className: 'js-term-assetItem', key: assetWinStart + i,
      style: { height: ASSET_ROW_H + 'px' }, disabled: unsupportedWindows,
      title: unsupportedWindows ? '当前插件不支持该资产类型' : '点击进入 ' + String(a.name ?? a.ip ?? ''),
      onClick: unsupportedWindows ? undefined : () => enterAsset(a),
    },
      h('span', { className: 'js-term-assetIdentity' },
        h('span', { className: 'js-term-assetTop' },
          h('span', { className: 'js-term-assetIp' }, a.ip ?? a.name ?? '?'),
          h('span', { className: 'js-term-assetPlatform' }, a.platform ?? ''),
        ),
        h('span', { className: 'js-term-assetBottom' },
          h('span', { className: 'js-term-assetName' }, a.name ?? ''),
          a.node ? h('span', { className: 'js-term-assetNode' }, String(a.node)) : null,
        ),
      ),
      h('span', { className: 'js-term-assetGo' }, unsupportedWindows ? '不支持' : '›'),
    )
  })

  const visibleTotal = buffer.rows.length
  const windowEnd = Math.min(visibleTotal, windowStart + Math.ceil(viewportH / ROW_H) + OVERSCAN * 2)
  const visibleRows = buffer.rows.slice(windowStart, windowEnd)

  const auditChip = (filter: AuditFilter, label: string, count: number): React.ReactNode => h('button', {
    type: 'button',
    className: 'js-term-auditSummaryChip' + (audit.filter === filter ? ' js-term-auditSummaryChipActive' : ''),
    onClick: () => setAudit((prev) => ({ ...prev, filter })),
  }, label + ' ' + count)

  const useAssetShortcut = (): boolean => atMenu && manualCommand.trim().toLowerCase() === 'p'
  const runManualOrShortcut = (): void => {
    if (useAssetShortcut()) {
      setManualCommand('')
      openAssetsTab()
      return
    }
    void submitManual()
  }

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
              type: 'text', className: 'js-term-search', value: assets.filter, placeholder: '搜索 IP / 主机名 / 系统 / 节点',
              onChange: (event: { target?: { value?: string } | null }) => searchAssets(event.target?.value ?? ''),
            }),
            h('button', { type: 'button', className: 'js-term-iconBtn', title: '刷新', onClick: () => void refreshAssets() }, '↻'),
          ),
          h('div', { className: 'js-term-groups' },
            h('button', { type: 'button', className: 'js-term-chip js-term-groupChip' + (assets.group === '' ? ' js-term-chipActive' : ''), onClick: () => pickGroup('') }, '全部 ' + String(assets.count)),
            assets.groups.map((g) => h('button', { type: 'button', key: g, className: 'js-term-chip js-term-groupChip' + (assets.group === g ? ' js-term-chipActive' : ''), onClick: () => pickGroup(g) }, g)),
          ),
          nodeGroups.length > 1
            ? h('div', { className: 'js-term-nodeGroups' },
                h('span', { className: 'js-term-groupLabel' }, '节点'),
                h('button', { type: 'button', className: 'js-term-chip js-term-groupChip' + (assets.node === '' ? ' js-term-chipActive' : ''), onClick: () => pickNode('') }, '全部'),
                nodeGroups.map(([node, count]) => h('button', { type: 'button', key: node, className: 'js-term-chip js-term-groupChip' + (assets.node === node ? ' js-term-chipActive' : ''), onClick: () => pickNode(node) }, node + ' ' + String(count))),
              )
            : null,
          assets.error !== null ? h('div', { className: 'js-term-manualError', role: 'status' }, assets.error) : null,
          assets.loading ? h('div', { className: 'js-term-empty' }, '加载中…') : (
            filteredAssets.length === 0
              ? h('div', { className: 'js-term-empty' }, '无匹配资产（在堡垒机菜单态可用）')
              : h('div', { className: 'js-term-assetList', onScroll: assetScroll },
                  h('div', { className: 'js-term-assetMeta' }, '显示 ' + filteredAssets.length + ' 台（缓存 ' + String(assets.count) + ' 台）' + (assets.fetchedAt !== null ? ' · 获取于 ' + fmtTime(new Date(assets.fetchedAt).toISOString()) : '')),
                  h('div', { className: 'js-term-assetWindow', style: { height: filteredAssets.length * ASSET_ROW_H + 'px', position: 'relative' } },
                    h('div', { style: { transform: 'translateY(' + assetWinStart * ASSET_ROW_H + 'px)' } }, assetRows),
                  ),
                )
          ),
        )
      : tab === 'audit'
        ? h('div', { className: 'js-term-audit' },
            h('div', { className: 'js-term-auditSummary' },
              auditChip('ALL', '全部', audit.records.length),
              auditChip('READ', 'READ', auditCounts['READ'] ?? 0),
              auditChip('UNKNOWN', 'UNKNOWN', auditCounts['UNKNOWN'] ?? 0),
              auditChip('MODIFY', '修改', (auditCounts['MODIFY'] ?? 0) + (auditCounts['DANGEROUS'] ?? 0)),
              auditChip('DANGEROUS', '高危', auditCounts['DANGEROUS'] ?? 0),
              auditChip('FAILED', '失败', auditCounts['FAILED'] ?? 0),
              h('span', { className: 'js-term-auditSummaryChip js-term-auditTimezone' }, 'UTC+8'),
            ),
            h('div', { className: 'js-term-searchRow' },
              h('input', {
                type: 'text', className: 'js-term-search', value: audit.search, placeholder: '搜索命令 / IP / 主机名 / Rule',
                onChange: (event: { target?: { value?: string } | null }) => setAudit((prev) => ({ ...prev, search: event.target?.value ?? '' })),
              }),
              h('button', { type: 'button', className: 'js-term-iconBtn', title: '复制过滤结果', onClick: () => copyToClipboard(auditFiltered.map((r) => [fmtTime(r['timestamp']), String(r['actor'] ?? ''), String(r['operation'] ?? ''), String(r['risk'] ?? ''), String(r['target'] ?? ''), String(r['redactedCommand'] ?? r['command'] ?? ''), 'rc=' + String(r['exitCode'] ?? '?')].join(' ')).join(String.fromCharCode(10))) }, '⧉'),
              h('button', { type: 'button', className: 'js-term-btn js-term-auditExport', title: '导出当前过滤结果 CSV', disabled: auditFiltered.length === 0, onClick: () => downloadAudit(auditFiltered, 'csv') }, 'CSV'),
              h('button', { type: 'button', className: 'js-term-btn js-term-auditExport', title: '导出当前过滤结果 JSON', disabled: auditFiltered.length === 0, onClick: () => downloadAudit(auditFiltered, 'json') }, 'JSON'),
              h('button', { type: 'button', className: 'js-term-btn js-term-auditExport', title: '导出当前过滤结果 Markdown', disabled: auditFiltered.length === 0, onClick: () => downloadAudit(auditFiltered, 'markdown') }, 'MD'),
              h('button', { type: 'button', className: 'js-term-iconBtn', title: '刷新', onClick: () => void refreshAudit() }, '↻'),
            ),
            audit.loading ? h('div', { className: 'js-term-empty' }, '加载中…') : (
              auditRows.length === 0 ? h('div', { className: 'js-term-empty' }, '暂无匹配审计记录') : h('div', { className: 'js-term-auditList' }, auditRows)
            ),
          )
        : h('div', { className: 'js-term-body', ref: bodyRef, onScroll: scrollHandler },
            newOutput > 0 && !follow
              ? h('button', { className: 'js-term-newOutput', type: 'button', onClick: () => { setFollow(true); setNewOutput(0) } }, '↓ ' + newOutput + ' 条新输出')
              : null,
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
          if (event.key === 'Enter' && event.shiftKey !== true) { event.preventDefault(); runManualOrShortcut() }
        },
      }),
      h('button', { type: 'button', className: 'js-term-iconBtn js-term-sendBtn', disabled: !manualAvailable || manualCommand.trim().length === 0, title: manualBusy ? t('manualSending') : t('manualSend'), 'aria-label': manualBusy ? t('manualSending') : t('manualSend'), onClick: runManualOrShortcut }, sendIcon(14)),
    ),
    confirmReq !== null
      ? h('div', { className: 'js-term-confirm', role: 'alertdialog' },
          h('div', { className: 'js-term-confirmText' },
            (String(confirmReq.risk ?? '') === 'UNKNOWN'
              ? '风险：无法确认该命令是否为只读（分类器无对应语义规则）；这不代表它一定会修改服务器。'
              : '风险：' + String(confirmReq.risk ?? 'MODIFY') + '（该命令会修改服务器运行状态）。') + '是否允许执行？'),
          h('div', { className: 'js-term-confirmCmd' }, confirmReq.command),
          confirmReq.expiresAt !== undefined
            ? h('div', { className: 'js-term-confirmHint' }, '确认链接 ' + Math.max(0, Math.round((confirmReq.expiresAt - Date.now()) / 1000)) + ' 秒内有效，仅限本次命令')
            : null,
          h('div', { className: 'js-term-confirmActions' },
            h('button', { type: 'button', className: 'js-term-btn js-term-btnDanger', onClick: () => { manualAbortRef.current?.abort(); setConfirmReq(null); setManualError(null) } }, '取消'),
            h('button', { type: 'button', className: 'js-term-btn js-term-btnPrimary', onClick: () => { const cmd = confirmReq.command; setConfirmReq(null); void submitManual(cmd, true, confirmReq.confirmToken) } }, '确认执行'),
          ),
        )
      : null,
    manualError !== null ? h('div', { className: 'js-term-manualError', role: 'status' }, manualError) : null,
    h('div', { className: 'js-term-footer' },
      h('div', { className: 'js-term-footerMeta' },
        networkError !== null ? h('span', { className: 'js-term-testErr' }, networkError) : h('span', { className: 'js-term-hint' }, atMenu ? 'p 资产 · IP/名称 进入 · q 关闭' : t('manualHint')),
      ),
      h('div', { className: 'js-term-actions' },
        h('button', { type: 'button', className: 'js-term-iconBtn', 'data-active': follow || undefined, 'aria-pressed': follow, 'aria-label': t('followTooltip'), title: t('followTooltip'), onClick: () => setFollow(!follow) }, followIcon(14)),
        h('button', { type: 'button', className: 'js-term-btn js-term-btnDanger', disabled: status.granted !== true, title: '关闭 SSH 并撤销本对话授权', onClick: () => void endAndLock() }, '🔒 结束并锁定'),
        h('button', { type: 'button', className: 'js-term-iconBtn', 'aria-label': t('clearTooltip'), title: t('clearTooltip'), onClick: clear }, clearIcon(14)),
      ),
    ),
  )
}
