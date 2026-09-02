import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import { JumpServerSession } from '../src/jumpserver/session.js'
import { SessionState } from '../src/jumpserver/state-machine.js'
import type { JumpServerConfig } from '../src/config/types.js'
import { TerminalObserver } from '../src/jumpserver/terminal-observer.js'
import { parseAssetList, filterAssetsByGroup, hasTrailingMenuPrompt } from '../src/jumpserver/asset-list.js'
import { PLUGIN_VERSION, PROTOCOL_VERSION, hostBuild, runtimeVersion } from '../src/version.js'
import { CLIENT_VERSION, CLIENT_BUILD } from '../src/client/version.js'
import { assetsToValue } from '../src/tools/common.js'
import { FakeWire, KOKO_MENU, KOKO_MENU_HOST_PROMPT, sessionConfig } from './helpers.js'

/**
 * V0.2.6 regressions:
 *  1. Host/Client version handshake (runtimeVersion + bundle identity).
 *  2. jumpserver_assets capture rebuilt from the SAME TerminalObserver event
 *     stream the sidebar renders (single fact stream).
 *  3. Once the asset payload starts, ANY captured byte refreshes the quiet
 *     timer (slow/fragmented output cannot truncate the list).
 *  4. rawText is gated behind includeRawText (context slimming).
 *  5. Asset groups: group="OA" OR-matches configured keywords.
 *  6. Real KoKo "[Host]> " prompts work end-to-end.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function baseConfig(overrides: Partial<JumpServerConfig> = {}): JumpServerConfig {
  return {
    enabled: true,
    autoOpenTerminal: true,
    terminalScrollback: 5000,
    host: '203.0.113.10',
    port: 2222,
    username: 'ops',
    passwordEnv: 'JUMPSERVER_PASSWORD',
    connectTimeout: 5,
    commandTimeout: 10,
    idleTimeout: 30,
    permissionMode: 'READ_ONLY',
    autoReconnect: true,
    enableAudit: false,
    ...overrides,
  }
}

function makeOptions(wire: FakeWire, overrides: Partial<SessionManagerOptions> = {}): SessionManagerOptions {
  return {
    getConfig: () => baseConfig(),
    resolvePassword: async () => 'secret',
    wireFactory: async () => wire,
    onLog: () => {},
    ...overrides,
  }
}

const ROWS =
  '  1      OA-APP-01      203.0.113.101       生产区\r\n' +
  '  2      workflow-app02  203.0.113.102       办公应用\r\n'
const FOOTER = '页码: 1\r\n每页行数: 2\r\n总页数: 1\r\n总数量: 2\r\nOpt> '

describe('V0.2.6 #1 version handshake', () => {
  it('runtimeVersion carries pluginVersion / hostBuild / protocolVersion', () => {
    const v = runtimeVersion()
    expect(v.pluginVersion).toBe(PLUGIN_VERSION)
    expect(v.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(v.hostBuild.length).toBeGreaterThan(0)
    // running from src (no lib/build-meta.json) -> 'dev'
    expect(v.hostBuild).toBe('dev')
  })

  it('src/version.ts stays in sync with package.json', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string }
    expect(PLUGIN_VERSION).toBe(pkg.version)
  })

  it('client bundle identity falls back to dev when not defined (tests/unbuilt)', () => {
    expect(CLIENT_VERSION).toBe('dev')
    expect(CLIENT_BUILD).toBe('dev')
  })

  it('hostBuild caches and never throws outside a build', () => {
    expect(hostBuild()).toBe(hostBuild())
  })
})

describe('V0.2.6 #2 single fact stream (observer read-back)', () => {
  it('manager.listAssets rebuilds the text from the observer events the sidebar rendered', async () => {
    const wire = new FakeWire()
    const observer = new TerminalObserver(5000)
    const manager = new SessionManager(makeOptions(wire, { observer }))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('p') ? ROWS + FOOTER : undefined))

    const result = await manager.listAssets(undefined, undefined, true)
    // The observer captured the SAME chunks the sidebar would show...
    const outputs = observer.snapshot().filter((e) => e.type === 'output')
    expect(outputs.length).toBeGreaterThan(0)
    // ...and the parsed result is complete + footer-verified.
    expect(result.health).toBe('ok')
    expect(result.reportedTotal).toBe(2)
    expect(result.parsedRows).toBe(2)
    expect(result.complete).toBe(true)
    await manager.close()
  })

  it('works without an observer (session-internal capture fallback)', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('p') ? ROWS + FOOTER : undefined))
    const result = await manager.listAssets(undefined, undefined, true)
    expect(result.health).toBe('ok')
    expect(result.reportedTotal).toBe(2)
    await manager.close()
  })
})

describe('V0.2.6 #3 quiet timer refreshes on ANY data after the payload starts', () => {
  it('a non-payload continuation chunk keeps the capture alive until the footer', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    // rows at t0 (payload), a NON-payload progress line at t0+600ms (would not
    // match the payload regex but still refreshes the quiet timer), footer at
    // t0+1200ms — >800ms after the last payload byte, so without the any-data
    // refresh the capture would truncate before the footer.
    wire.queue((w: string) => {
      if (!w.startsWith('p')) return undefined
      wire.emit(ROWS)
      setTimeout(() => wire.emit('\r\n（以上为全部资产，请核对）\r\n'), 600)
      setTimeout(() => wire.emit(FOOTER), 1200)
      return undefined
    })
    const result = await manager.listAssets(undefined, undefined, true)
    expect(result.health).toBe('ok')
    expect(result.reportedTotal).toBe(2)
    expect(result.complete).toBe(true)
    await manager.close()
  })
})

describe('V0.2.6 #4 rawText gating', () => {
  const base = {
    assets: [
      { index: 1, name: 'OA-APP-01', ip: '203.0.113.101', platform: 'Linux', node: null, comment: '生产区', raw: '1 OA-APP-01' },
    ],
    count: 1,
    filter: null,
    group: null,
    groupMatched: 0,
    truncated: false,
    paged: false,
    rawText: ROWS + FOOTER,
    rawRows: 2,
    parsedRows: 2,
    page: 1,
    pageSize: 2,
    totalPages: 1,
    reportedTotal: 2,
    complete: true,
    health: 'ok',
  }

  it('omits rawText by default', () => {
    const value = assetsToValue(base)
    expect(value['rawText']).toBeUndefined()
  })

  it('includes a bounded rawText when includeRawText is set', () => {
    const value = assetsToValue(base, { includeRawText: true })
    expect(typeof value['rawText']).toBe('string')
    expect(String(value['rawText'])).toContain('OA-APP-01')
  })
})

describe('V0.2.6 #5 asset groups', () => {
  const GROUPS = {
    OA: { keywords: ['OA', 'portal', 'workflow', '办公'] },
    CRM: { keywords: ['CRM', 'lego'] },
  }

  it('filterAssetsByGroup OR-matches keywords across fields', () => {
    const parsed = parseAssetList(ROWS + FOOTER)
    const oa = filterAssetsByGroup(parsed.assets, GROUPS.OA.keywords)
    expect(oa.map((a) => a.name)).toEqual(['OA-APP-01', 'workflow-app02']) // portal/workflow/办公 aliases
    expect(filterAssetsByGroup(parsed.assets, GROUPS.CRM.keywords)).toHaveLength(0)
    expect(filterAssetsByGroup(parsed.assets, [])).toHaveLength(0)
  })

  it('jumpserver_assets(group=...) resolves group keywords and reports groupMatched', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire, { getConfig: () => baseConfig({ assetGroups: GROUPS }) }))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('p') ? ROWS + FOOTER : undefined))
    const result = await manager.listAssets(undefined, undefined, true, 'OA')
    expect(result.group).toBe('OA')
    expect(result.groupMatched).toBe(2)
    expect(result.assets.map((a) => a.name)).toEqual(['OA-APP-01', 'workflow-app02'])
    expect(result.reportedTotal).toBe(2)
    await manager.close()
  })

  it('an unknown group is INVALID_GROUP, never "0 assets"', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire, { getConfig: () => baseConfig({ assetGroups: GROUPS }) }))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('p') ? ROWS + FOOTER : undefined))
    await expect(manager.listAssets(undefined, undefined, true, 'SAP')).rejects.toMatchObject({ code: 'INVALID_GROUP' })
    await manager.close()
  })
})

describe('V0.2.6 #6 real KoKo "[Host]> " prompts', () => {
  const HOST_TABLE =
    '\r\n' +
    '  1      OA-APP-01      203.0.113.101       生产区\r\n' +
    '页码: 1\r\n每页行数: 1\r\n总页数: 1\r\n总数量: 1\r\n' +
    '[Host]> '

  it('the "[Host]> " prompt completes capture (hasTrailingMenuPrompt + footer)', () => {
    const r = parseAssetList(HOST_TABLE)
    expect(r.health).toBe('ok')
    expect(r.reportedTotal).toBe(1)
    expect(r.complete).toBe(true)
    expect(hasTrailingMenuPrompt('[Host]> ')).toBe(true)
    // "[Host]> p" echo-only is still INCOMPLETE, never LIST_EMPTY
    expect(parseAssetList('\r\n[Host]> p\r\n[Host]> ').health).toBe('ASSET_CAPTURE_INCOMPLETE')
  })

  it('connect() recognises a menu that prompts with "[Host]> "', async () => {
    const wire = new FakeWire()
    const session = new JumpServerSession(sessionConfig(async () => wire), {})
    setTimeout(() => wire.emit(KOKO_MENU_HOST_PROMPT), 20)
    await session.connect()
    expect(session.state).toBe(SessionState.JUMPSERVER_MENU)
    // and a 'p' capture completes on the "[Host]> " prompt
    wire.queue((w: string) => (w.startsWith('p') ? HOST_TABLE : undefined))
    const captured = await session.listAssets(2000, undefined)
    expect(captured.text).toContain('总数量: 1')
    expect(captured.footerComplete).toBe(true)
    expect(captured.reportedTotal).toBe(1)
    await session.close()
  })
})
