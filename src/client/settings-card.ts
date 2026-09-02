/**
 * JumpServer settings card (settings.plugin.item, keyed 'jumpserver').
 *
 * Reads the resolved namespace through the client settings scope; stages edits
 * locally; a single 保存 validates every draft up front, writes the password to
 * the CREDENTIALS domain first, then commits the settings patch field by field
 * and — if any later write fails — best-effort ROLLS BACK the fields already
 * landed before reporting the failing field (V0.3.1 P1: no partial saves).
 * 测试连接 is draft-aware: it tests what the form currently contains, never
 * silently the saved config. V0.2.7 UI: Connection / Security / Session /
 * Terminal sections, permission modes as radio cards, manual-terminal policy
 * radios, an assetGroups JSON editor and the asset-cache TTL field.
 */
import * as React from 'react'
import { fetchTestConnection, type TestResponse } from './api.js'
import type { LocaleMap } from './locales.js'

const h = React.createElement

const DEFAULT_PASSWORD_ENV = 'JUMPSERVER_PASSWORD'
const LF = String.fromCharCode(10)

type ScopeLike = {
  getSnapshot(): { status: string; writable: boolean; value?: Record<string, unknown>; base?: Record<string, unknown>; user?: Record<string, unknown>; revision?: number }
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
}

type ApiLike = {
  credentials: {
    describe(args: { refs: string[] }): Promise<{ result: { ok: boolean; value?: { credentials?: Record<string, { configured?: boolean; writable?: boolean }> } } }>
    set(args: { ref: string; value: string }): Promise<unknown>
  }
}

const PERMISSION_OPTIONS = [
  { value: 'READ_ONLY', key: 'permissionReadOnly', hint: '仅允许诊断命令（默认）' },
  { value: 'AUTO', key: 'permissionAuto', hint: '修改命令执行前询问' },
  { value: 'FULL_ACCESS', key: 'permissionFull', hint: '普通修改自动执行，高危仍确认' },
] as const

const MANUAL_OPTIONS = [
  { value: 'CONFIRM_MODIFY', label: '修改命令二次确认', hint: '只读放行，修改命令需二次确认（默认）' },
  { value: 'FOLLOW_AGENT', label: '跟随 Agent 权限', hint: '只读模式拦修改；自动模式修改需确认；完全开放仅高危确认（V0.3.1）' },
  { value: 'FULL_ACCESS', label: '完全开放', hint: '人工输入不设限（仍审计，V0.2.7 前旧行为）' },
] as const

function sectionTitle(text: string): React.ReactNode {
  return h('p', { className: 'js-term-cardSectionTitle' }, text)
}

function radioCards(name: string, options: ReadonlyArray<{ value: string; key?: string; label?: string; hint: string }>, selected: string, disabled: boolean, onPick: (value: string) => void, t: LocaleMap): React.ReactNode {
  return h('div', { className: 'js-term-radio', key: name },
    options.map((option) => {
      const label = option.label ?? (t as unknown as Record<string, string>)[option.key ?? ''] ?? option.value
      return h('label', { className: 'js-term-radioCard', key: option.value, 'data-on': selected === option.value || undefined },
        h('input', {
          type: 'radio', name: name, value: option.value, checked: selected === option.value, disabled,
          onChange: () => onPick(option.value),
        }),
        h('span', { className: 'js-term-radioTitle' },
          h('span', null, label),
          h('span', { className: 'js-term-radioHint' }, option.hint),
        ),
      )
    }),
  )
}

export interface SettingsCardProps {
  t: LocaleMap
  scope: ScopeLike
  api: ApiLike
}

export function JumpServerSettingsCard({ t, scope, api }: SettingsCardProps): React.ReactElement | null {
  const subscribed = React.useSyncExternalStore(
    React.useCallback((cb: () => void) => scope.subscribe(cb), [scope]),
    React.useCallback(() => scope.getSnapshot(), [scope]),
  )
  const available = subscribed?.status === 'ready'
  const writable = subscribed?.writable === true
  const resolved = (subscribed?.value ?? {}) as Record<string, unknown>
  const user = (subscribed?.user ?? {}) as Record<string, unknown>

  const [open, setOpen] = React.useState(false)
  const [drafts, setDrafts] = React.useState<Record<string, string>>({})
  const [bools, setBools] = React.useState<Record<string, boolean>>({})
  const [saving, setSaving] = React.useState(false)
  const [fieldErrors, setFieldErrors] = React.useState<string[]>([])
  const [testing, setTesting] = React.useState(false)
  const [testResult, setTestResult] = React.useState<TestResponse | null>(null)
  const [passwordConfigured, setPasswordConfigured] = React.useState<boolean | null>(null)
  const [passwordWritable, setPasswordWritable] = React.useState(true)

  const passwordRef = String(drafts['passwordEnv'] ?? resolved['passwordEnv'] ?? DEFAULT_PASSWORD_ENV)

  React.useEffect(() => {
    let cancelled = false
    api.credentials
      .describe({ refs: [passwordRef] })
      .then((response) => {
        if (cancelled) return
        const view = response.result?.value?.credentials?.[passwordRef]
        setPasswordConfigured(view?.configured ?? false)
        setPasswordWritable(view?.writable ?? true)
      })
      .catch(() => {
        if (!cancelled) setPasswordConfigured(false)
      })
    return () => { cancelled = true }
  }, [api, passwordRef])

  if (!available) return null

  const field = (name: string): string => {
    if (name in drafts) return drafts[name]!
    const current = resolved[name]
    return current === undefined ? '' : String(current)
  }
  const boolValue = (name: string): boolean =>
    name in bools ? bools[name]! : (resolved[name] === true || resolved[name] === 'true' || resolved[name] === 1)
  const overridden = (name: string): boolean => Object.prototype.hasOwnProperty.call(user, name)

  const edit = (name: string, text: string): void => {
    setDrafts((prev) => ({ ...prev, [name]: text }))
    setFieldErrors([])
  }
  const toggle = (name: string): void => {
    setBools((prev) => ({ ...prev, [name]: !boolValue(name) }))
    setFieldErrors([])
  }
  const resetField = (name: string): void => {
    const clearDraft = (): void => {
      setDrafts((prev) => { const next = { ...prev }; delete next[name]; return next })
      setBools((prev) => { const next = { ...prev }; delete next[name]; return next })
    }
    if (overridden(name)) void scope.unset(name).then(clearDraft)
    else clearDraft()
    setFieldErrors([])
  }

  const dirty = Object.keys(drafts).length > 0 || Object.keys(bools).length > 0
  const numberOrNull = (text: string): number | null => {
    const trimmed = text.trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }

  const parseAssetGroups = (text: string): { ok: true; value: Record<string, { keywords: string[] }> } | { ok: false; error: string } => {
    const trimmed = text.trim()
    if (trimmed === '') return { ok: true, value: {} }
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'assetGroups 必须是对象：{ "OA": { "keywords": ["OA","portal"] } }' }
      const out: Record<string, { keywords: string[] }> = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const def = v as { keywords?: unknown }
        if (!Array.isArray(def?.keywords) || !def.keywords.every((x) => typeof x === 'string')) {
          return { ok: false, error: 'assetGroups 的 ' + k + ' 缺少 keywords 字符串数组' }
        }
        out[k] = { keywords: def.keywords.map((x) => String(x)) }
      }
      return { ok: true, value: out }
    } catch (error) {
      return { ok: false, error: 'assetGroups JSON 解析失败: ' + (error instanceof Error ? error.message : String(error)) }
    }
  }

  const save = async (): Promise<void> => {
    if (saving || !writable) return
    setSaving(true)
    setFieldErrors([])
    const errors: string[] = []

    // 1) validate every draft BEFORE any mutation; V0.3.1 still snapshots every
    //    touched field so a backend failure mid-write can be rolled back
    for (const name of ['port', 'connectTimeout', 'commandTimeout', 'idleTimeout', 'terminalScrollback', 'assetCacheTtlSeconds']) {
      if (!(name in drafts)) continue
      const n = numberOrNull(drafts[name] ?? '')
      if (n === null) errors.push(name + ': 必须是数字')
    }
    if ('host' in drafts && drafts['host']!.trim().length === 0) errors.push('host: 不能为空')
    if ('username' in drafts && drafts['username']!.trim().length === 0) errors.push('username: 不能为空')
    if ('assetGroups' in drafts) {
      const parsed = parseAssetGroups(drafts['assetGroups'] ?? '')
      if (!parsed.ok) errors.push(parsed.error)
    }
    if (errors.length > 0) {
      setFieldErrors(errors)
      setSaving(false)
      return
    }

    let landed = true
    // 2) Snapshot the CURRENT saved value of every settings field we are about
    //    to touch. If a later scope.write fails mid-way, these snapshots make a
    //    best-effort rollback possible — validate-first alone still left the
    //    classic partial-write: host+port landed, username failed,
    //    permissionMode never ran (V0.3.1 P1).
    const snapshots: Record<string, { kind: 'set' | 'unset'; value?: unknown }> = {}
    const snapshotField = (name: string): void => {
      if (snapshots[name] !== undefined) return
      const current = resolved[name]
      snapshots[name] = current === undefined ? { kind: 'unset' } : { kind: 'set', value: current }
    }
    const written: string[] = []
    const mark = (name: string, ok: boolean): void => {
      if (ok) written.push(name)
      landed = landed && ok
    }

    // 3) password FIRST (credentials domain) so a failed settings write never
    //    leaves passwordEnv pointing at an unstored credential
    const password = drafts['password'] ?? ''
    if (password !== '') {
      try { await api.credentials.set({ ref: passwordRef, value: password }); written.push('password') } catch { landed = false }
    }
    // 4) settings patch (per-field); failures report the exact field
    const textFields: Array<[string, 'string' | 'number']> = [
      ['host', 'string'], ['port', 'number'], ['username', 'string'], ['passwordEnv', 'string'],
      ['connectTimeout', 'number'], ['commandTimeout', 'number'], ['idleTimeout', 'number'],
      ['terminalScrollback', 'number'], ['assetCacheTtlSeconds', 'number'],
    ]
    for (const [name, kind] of textFields) {
      if (!(name in drafts)) continue
      snapshotField(name)
      const text = (drafts[name] ?? '').trim()
      if (text === '') {
        if (overridden(name)) { const ok = await scope.unset(name); mark(name, ok); if (!ok) errors.push(name + ': 重置失败') }
        continue
      }
      const ok = kind === 'number' ? await scope.set(name, numberOrNull(text)) : await scope.set(name, text)
      mark(name, ok)
      if (!ok) errors.push(name + ': 保存失败')
    }
    if ('assetGroups' in drafts) {
      snapshotField('assetGroups')
      const parsed = parseAssetGroups(drafts['assetGroups'] ?? '')
      if (parsed.ok) {
        const ok = await scope.set('assetGroups', parsed.value)
        mark('assetGroups', ok)
        if (!ok) errors.push('assetGroups: 保存失败')
      }
    }
    for (const name of ['enabled', 'autoReconnect', 'enableAudit', 'autoOpenTerminal']) {
      if (!(name in bools)) continue
      snapshotField(name)
      const ok = await scope.set(name, bools[name]!)
      mark(name, ok)
      if (!ok) errors.push(name + ': 保存失败')
    }
    for (const name of ['permissionMode', 'manualPermissionMode']) {
      if (!(name in drafts)) continue
      snapshotField(name)
      const ok = await scope.set(name, drafts[name]!)
      mark(name, ok)
      if (!ok) errors.push(name + ': 保存失败')
    }

    // 5) any failure -> best-effort rollback of exactly the fields that landed
    //    (newest first). Note: a stored draft password is not rolled back — the
    //    credentials API has no delete — but it is only written under the ref
    //    the form currently shows, so it is never orphaned by a settings miss.
    if (!landed) {
      const rollbackFailed: string[] = []
      for (const name of [...written].reverse()) {
        const before = snapshots[name]
        if (before === undefined) continue // e.g. 'password' (no unset API)
        const ok = before.kind === 'unset' ? await scope.unset(name) : await scope.set(name, before.value)
        if (!ok) rollbackFailed.push(name)
      }
      if (rollbackFailed.length > 0) errors.push('回滚未完全成功: ' + rollbackFailed.join(', '))
      setFieldErrors(errors)
      setSaving(false)
      return
    }

    setDrafts({})
    setBools({})
    setFieldErrors(errors)
    setSaving(false)
  }

  const discard = (): void => {
    setDrafts({})
    setBools({})
    setFieldErrors([])
    setTestResult(null)
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      // V0.2.7 P1: test the DRAFT — never silently the saved config
      // V0.3.1: passwordEnv is a draft field too (changing the credential ref
      // without retyping the password must test against the NEW ref).
      const draft: { host?: string; port?: number; username?: string; password?: string; passwordEnv?: string } = {}
      if ('host' in drafts) draft.host = drafts['host']!.trim()
      if ('port' in drafts) draft.port = Number(drafts['port'])
      if ('username' in drafts) draft.username = drafts['username']!.trim()
      if ('password' in drafts && drafts['password']!.length > 0) draft.password = drafts['password']
      if ('passwordEnv' in drafts && drafts['passwordEnv']!.trim().length > 0) draft.passwordEnv = drafts['passwordEnv']!.trim()
      setTestResult(await fetchTestConnection(draft))
    } catch (error) {
      setTestResult({ ok: false, code: 'BRIDGE_ERROR', message: error instanceof Error ? error.message : String(error) })
    } finally {
      setTesting(false)
    }
  }

  const blocked = !dirty || saving

  const input = (name: string, label: string, hint: string, numeric = false): React.ReactNode =>
    h('div', { className: 'js-term-cardField', key: name },
      h('div', { className: 'js-term-cardHead' },
        h('label', { className: 'js-term-cardLabel', htmlFor: 'js-card-' + name }, label),
        overridden(name) ? h('span', { className: 'js-term-badge' }, t.overridden) : null,
        overridden(name) ? h('button', { type: 'button', className: 'js-term-btn', onClick: () => resetField(name) }, t.reset) : null,
      ),
      h('input', {
        id: 'js-card-' + name, type: 'text', inputMode: numeric ? 'numeric' : undefined,
        value: field(name), disabled: !writable,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => edit(name, event.target.value),
      }),
      hint.length > 0 ? h('p', { className: 'js-term-cardHint' }, hint) : null,
    )

  const switchField = (name: string, label: string, hint: string): React.ReactNode =>
    h('div', { className: 'js-term-cardField', key: name },
      h('div', { className: 'js-term-cardHead' },
        h('label', { className: 'js-term-cardLabel', htmlFor: 'js-card-' + name }, label),
        h('label', { className: 'js-term-switch' },
          h('input', { id: 'js-card-' + name, type: 'checkbox', checked: boolValue(name), disabled: !writable, onChange: () => toggle(name) }),
          h('span', { className: 'js-term-track' }),
          h('span', { className: 'js-term-thumb' }),
        ),
      ),
      h('p', { className: 'js-term-cardHint' }, hint),
    )

  const groupedField = (
    name: string,
    label: string,
    hint: string,
  ): React.ReactNode =>
    h('div', { className: 'js-term-cardRow' },
      input(name, label, hint, false),
    )

  return h('li', { className: 'js-term-card' },
    h('button', { type: 'button', className: 'js-term-cardHeader', 'aria-expanded': open, onClick: () => setOpen(!open) },
      h('span', { className: 'js-term-cardHeadText' },
        h('span', { className: 'js-term-cardName' }, t.cardTitle),
        h('span', { className: 'js-term-cardDesc' }, t.cardDescription),
      ),
      dirty ? h('span', { className: 'js-term-badge js-term-dirty' }, t.unsaved) : null,
      h('span', { className: 'js-term-chevron', 'data-open': open || undefined }, open ? '▲' : '▼'),
    ),
    open
      ? h('div', { className: 'js-term-cardBody' },
          !writable ? h('p', { className: 'js-term-cardHint' }, t.readOnlyStorage) : null,

          sectionTitle('连接'),
          switchField('enabled', t.enabled, t.enabledHint),
          h('div', { className: 'js-term-cardRow' }, input('host', t.host, t.hostHint), input('port', t.port, t.portHint, true)),
          input('username', t.username, t.usernameHint),
          h('div', { className: 'js-term-cardField', key: 'password' },
            h('div', { className: 'js-term-cardHead' },
              h('label', { className: 'js-term-cardLabel', htmlFor: 'js-card-password' }, t.password),
              h('span', { className: 'js-term-badge', 'data-on': passwordConfigured === true || undefined }, passwordConfigured === true ? t.passwordSaved : t.passwordUnset),
            ),
            h('input', {
              id: 'js-card-password', type: 'password', autoComplete: 'off', value: drafts['password'] ?? '',
              placeholder: passwordConfigured === true ? '●●●●●●●●' : '', disabled: !writable || passwordWritable === false,
              onChange: (event: React.ChangeEvent<HTMLInputElement>) => edit('password', event.target.value),
            }),
            h('p', { className: 'js-term-cardHint' }, t.passwordHint),
          ),
          input('passwordEnv', t.passwordEnv, t.passwordEnvHint),
          h('div', { className: 'js-term-cardField', key: 'test' },
            h('button', { type: 'button', className: 'js-term-btn' + (dirty ? ' js-term-btnPrimary' : ''), disabled: testing, onClick: () => void runTest() },
              (testing ? t.testing : t.testConnection) + (dirty ? '（用未保存配置）' : '')),
            testResult !== null
              ? h('p', { className: 'js-term-testResult ' + (testResult.ok ? 'js-term-testOk' : 'js-term-testErr'), role: 'status' },
                  (testResult.ok ? t.testOk : t.testFail) +
                  (testResult.message ? LF + testResult.message : '') +
                  (testResult.gateway ? LF + testResult.gateway : '') +
                  (testResult.latencyMs !== undefined ? LF + 'latency: ' + testResult.latencyMs + ' ms' : '') +
                  (testResult.draft === true ? LF + '(使用未保存配置测试)' : ''))
              : null,
          ),

          sectionTitle('权限与安全'),
          h('div', { className: 'js-term-cardField', key: 'permissionMode' },
            h('div', { className: 'js-term-cardHead' }, h('label', { className: 'js-term-cardLabel' }, t.permissionMode), overridden('permissionMode') ? h('span', { className: 'js-term-badge' }, t.overridden) : null),
            radioCards('permissionMode', PERMISSION_OPTIONS, 'permissionMode' in drafts ? drafts['permissionMode']! : String(resolved['permissionMode'] ?? 'READ_ONLY'), !writable, (v) => edit('permissionMode', v), t),
            h('p', { className: 'js-term-cardHint' }, t.permissionModeHint),
          ),
          h('div', { className: 'js-term-cardField', key: 'manualPermissionMode' },
            h('div', { className: 'js-term-cardHead' }, h('label', { className: 'js-term-cardLabel' }, '人工终端输入'), overridden('manualPermissionMode') ? h('span', { className: 'js-term-badge' }, t.overridden) : null),
            radioCards('manualPermissionMode', MANUAL_OPTIONS, 'manualPermissionMode' in drafts ? drafts['manualPermissionMode']! : String(resolved['manualPermissionMode'] ?? 'CONFIRM_MODIFY'), !writable, (v) => edit('manualPermissionMode', v), t),
            h('p', { className: 'js-term-cardHint' }, 'V0.2.7：浏览器人工终端的独立权限策略（Agent 仍走左侧权限矩阵）'),
          ),
          switchField('enableAudit', t.enableAudit, t.enableAuditHint),

          sectionTitle('会话'),
          h('div', { className: 'js-term-cardRow' }, input('connectTimeout', t.connectTimeout, '', true), input('commandTimeout', t.commandTimeout, '', true)),
          h('div', { className: 'js-term-cardRow' }, input('idleTimeout', t.idleTimeout, '', true), input('assetCacheTtlSeconds', '资产缓存', '资产列表 p 抓取缓存秒数（默认 300）', true)),
          switchField('autoReconnect', t.autoReconnect, t.autoReconnectHint),

          sectionTitle('终端'),
          switchField('autoOpenTerminal', t.autoOpenTerminal, t.autoOpenTerminalHint),
          input('terminalScrollback', t.terminalScrollback, t.terminalScrollbackHint, true),
          h('div', { className: 'js-term-cardField', key: 'assetGroups' },
            h('div', { className: 'js-term-cardHead' },
              h('label', { className: 'js-term-cardLabel', htmlFor: 'js-card-assetGroups' }, '资产分组（assetGroups）'),
              overridden('assetGroups') ? h('span', { className: 'js-term-badge' }, t.overridden) : null,
            ),
            h('textarea', {
              id: 'js-card-assetGroups', rows: 4, spellCheck: false,
              value: field('assetGroups'), disabled: !writable,
              placeholder: '{ "OA": { "keywords": ["OA","portal","workflow","办公"] }, "ESB": { "keywords": ["ESB","接口"] } }',
              onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => edit('assetGroups', event.target.value),
            }),
            h('p', { className: 'js-term-cardHint' }, '组名 -> 关键词 JSON；jumpserver_assets(group="OA") 与资产选择器按关键词 OR 匹配'),
          ),

          h('div', { className: 'js-term-cardFooter' },
            fieldErrors.length > 0 ? h('div', { className: 'js-term-fieldErrors', role: 'status' }, fieldErrors.map((e, i) => h('span', { key: i }, e))) : null,
            h('button', { type: 'button', className: 'js-term-btn', onClick: discard }, t.discard),
            h('button', { type: 'button', className: 'js-term-btn js-term-save', disabled: blocked || !writable, onClick: () => void save() }, saving ? t.saving : t.save),
          ),
        )
      : null,
  )
}
