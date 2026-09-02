import { describe, expect, it } from 'vitest'
import { SessionManager, type SessionManagerOptions } from '../src/jumpserver/session-manager.js'
import type { JumpServerConfig } from '../src/config/types.js'
import { parseAssetList, looksPaged } from '../src/jumpserver/asset-list.js'
import { FakeWire, KOKO_MENU } from './helpers.js'

function makeOptions(wire: FakeWire, overrides: Partial<SessionManagerOptions> = {}): SessionManagerOptions {
  const cfg: JumpServerConfig = {
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
  }
  return {
    getConfig: () => cfg,
    resolvePassword: async () => 'secret',
    wireFactory: async () => wire,
    onLog: () => {},
    ...overrides,
  }
}

/** KoKo-style 'p' output with the real footer block (V0.2.5). */
const footerTable =
  '\r\n' +
  '  1      OA-APP-01      203.0.113.101       生产区\r\n' +
  '  2      OA-APP-02      203.0.113.102       生产区\r\n' +
  '页码: 1\r\n' +
  '每页行数: 2\r\n' +
  '总页数: 1\r\n' +
  '总数量: 2\r\n' +
  'Opt> '

/** KoKo-style 'p' output: numbered rows with name / ip / comment columns. */
const ASSET_TABLE =
  '\r\n' +
  '  1      OA-APP-01      203.0.113.101       生产区\r\n' +
  '  2      OA-APP-02      203.0.113.102       生产区\r\n' +
  '  3      OA-NGINX-01    203.0.113.99        入口\r\n' +
  '  4      DB-MYSQL-01    203.0.113.120       数据库\r\n' +
  'Opt> '

describe('parseAssetList (KoKo p screen -> rows)', () => {
  it('parses numbered rows and splits name/ip/comment', () => {
    const r = parseAssetList(ASSET_TABLE)
    expect(r.assets).toHaveLength(4)
    expect(r.assets[0]).toMatchObject({ index: 1, name: 'OA-APP-01', ip: '203.0.113.101', comment: '生产区' })
    expect(r.assets[2]).toMatchObject({ name: 'OA-NGINX-01', ip: '203.0.113.99' })
  })

  it('applies a local case-insensitive filter across name/ip/comment', () => {
    expect(parseAssetList(ASSET_TABLE, 'oa').assets.map((a) => a.name)).toEqual(['OA-APP-01', 'OA-APP-02', 'OA-NGINX-01'])
    expect(parseAssetList(ASSET_TABLE, 'nginx').assets).toHaveLength(1)
    expect(parseAssetList(ASSET_TABLE, '113.120').assets.map((a) => a.name)).toEqual(['DB-MYSQL-01'])
    expect(parseAssetList(ASSET_TABLE, 'nomatch').assets).toHaveLength(0)
  })

  it('drops menu chrome (prompts, frames) and headers', () => {
    const messy = 'Opt> \n' + ASSET_TABLE + '\r\n────────────────────\r\n请输入编号或资产名: \r\n'
    const r = parseAssetList(messy)
    expect(r.assets).toHaveLength(4)
  })

  it('looksPaged only fires on pager hints', () => {
    expect(looksPaged('...\r\n-- 更多 --\r\n')).toBe(true)
    expect(looksPaged(ASSET_TABLE)).toBe(false)
  })
})

describe('SessionManager.listAssets (real p flow on the wire)', () => {
  it('connects, sends p, captures the table and filters locally', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('p') || w === 'p' ? ASSET_TABLE : undefined))

    const result = await manager.listAssets('OA')
    expect(result.assets.map((a) => a.name)).toEqual(['OA-APP-01', 'OA-APP-02', 'OA-NGINX-01'])
    expect(result.count).toBe(3)
    // V0.2.5 P0: a real interactive PTY Enter is CR, not LF.
    expect(wire.writes.join('\n')).toContain('p\r')
    expect(result.paged).toBe(false)
    await manager.close()
  })

  it('reports an empty authorized list for a non-matching filter', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('p') ? ASSET_TABLE : undefined))

    const result = await manager.listAssets('zzz')
    expect(result.assets).toHaveLength(0)
    await manager.close()
  })
})
describe('V0.2.5 asset-list stabilization', () => {
  it('parses the KoKo footer into page/pageSize/totalPages/reportedTotal/complete', () => {
    const r = parseAssetList(footerTable)
    expect(r.health).toBe('ok')
    expect(r.reportedTotal).toBe(2)
    expect(r.page).toBe(1)
    expect(r.pageSize).toBe(2)
    expect(r.totalPages).toBe(1)
    expect(r.complete).toBe(true)
    expect(r.parsedRows).toBe(2)
  })

  it('ASSET_CAPTURE_INCOMPLETE: only the p echo / prompt, no payload', () => {
    // The old code reported ASSET_LIST_EMPTY for this — an echo is NOT an
    // empty account (V0.2.5 P0).
    expect(parseAssetList('p\r\nOpt> ').health).toBe('ASSET_CAPTURE_INCOMPLETE')
    expect(parseAssetList('\r\nOpt> \r\n').health).toBe('ASSET_CAPTURE_INCOMPLETE')
  })

  it('ASSET_LIST_EMPTY requires footer 总数量 0 or an explicit no-asset notice', () => {
    const emptyFooter = '页码: 1\r\n每页行数: 0\r\n总页数: 1\r\n总数量: 0\r\nOpt> '
    expect(parseAssetList(emptyFooter).health).toBe('ASSET_LIST_EMPTY')
    expect(parseAssetList('无资产\r\nOpt> ').health).toBe('ASSET_LIST_EMPTY')
  })

  it('connects, sends p\r, captures table + footer and reports a verified result', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('p') ? footerTable : undefined))
    const result = await manager.listAssets(undefined, undefined, true)
    expect(result.health).toBe('ok')
    expect(result.reportedTotal).toBe(2)
    expect(result.parsedRows).toBe(2)
    expect(result.complete).toBe(true)
    expect(wire.writes.filter((w) => w === 'p\r').length).toBe(1)
    await manager.close()
  })

  it('failed captures are NOT cached', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('p') ? 'p\r\nOpt> ' : undefined)) // echo only
    const bad = await manager.listAssets('oa')
    expect(bad.health).toBe('ASSET_CAPTURE_INCOMPLETE')
    await manager.close()
  })

  it('healthy captures ARE cached; refresh:true forces a fresh p', async () => {
    const wire = new FakeWire()
    const manager = new SessionManager(makeOptions(wire, { getConfig: () => ({ ...makeOptions(wire).getConfig(), assetCacheTtlSeconds: 300 }) }))
    setTimeout(() => wire.emit(KOKO_MENU), 20)
    wire.queue((w: string) => (w.startsWith('p') ? ASSET_TABLE : undefined))
    await manager.listAssets()
    expect(wire.writes.filter((w) => w === 'p\r').length).toBe(1)
    // cached: no new p
    await manager.listAssets('oa')
    expect(wire.writes.filter((w) => w === 'p\r').length).toBe(1)
    // refresh:true forces a fresh capture: new p
    wire.queue((w: string) => (w.startsWith('p') ? ASSET_TABLE : undefined))
    await manager.listAssets('ng', undefined, true)
    expect(wire.writes.filter((w) => w === 'p\r').length).toBe(2)
    await manager.close()
  })
})

