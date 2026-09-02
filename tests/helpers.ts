import type { Wire } from '../src/jumpserver/client.js'

/** Deterministic test transport: replies are queued per session write. */
export class FakeWire implements Wire {
  writes: string[] = []
  private dataCbs = new Set<(chunk: string) => void>()
  private closeCbs = new Set<() => void>()
  private replies: Array<string | ((written: string) => string | undefined)> = []
  private closedFlag = false

  onData(cb: (chunk: string) => void): void {
    this.dataCbs.add(cb)
  }
  onError(_cb: (err: Error) => void): void {
    /* not exercised */
  }
  onClose(cb: () => void): void {
    this.closeCbs.add(cb)
  }
  write(text: string): void {
    this.writes.push(text)
    const next = this.replies.shift()
    const reply = typeof next === 'function' ? next(text) : next
    if (reply !== undefined) this.emit(reply)
  }
  emit(chunk: string): void {
    for (const cb of [...this.dataCbs]) cb(chunk)
  }
  queue(reply: string | ((written: string) => string | undefined)): void {
    this.replies.push(reply)
  }
  close(): void {
    this.closedFlag = true
    for (const cb of [...this.closeCbs]) cb()
  }
  get closed(): boolean {
    return this.closedFlag
  }
}

export const KOKO_MENU =
  '\r\n' +
  '        ┌──────────────────────────────────────────────┐\r\n' +
  '        │            JumpServer Terminal               │\r\n' +
  '        └──────────────────────────────────────────────┘\r\n' +
  '  1.  input\r\n' +
  '  2.  search\r\n' +
  '  0.  exit\r\n' +
  '  请输入编号或资产名: \r\n'

/**
 * V0.2.6: real KoKo deployments prompt with the node name they expect you to
 * type (e.g. "[Host]> "), and their menu chrome may be partially English.
 * The detector must recognise this menu and the asset-capture completion
 * logic must accept "[Host]> " as the returned menu prompt.
 */
export const KOKO_MENU_HOST_PROMPT =
  '\r\n' +
  '        ┌──────────────────────────────────────────────┐\r\n' +
  '        │            JumpServer Terminal               │\r\n' +
  '        └──────────────────────────────────────────────┘\r\n' +
  '  1.  input\r\n' +
  '  2.  search\r\n' +
  '  0.  exit\r\n' +
  '  Please enter number or asset name: \r\n' +
  '[Host]> '

export const ASSET_PROMPT = '\r\n[root@web-app-01 ~]# '

export function probeReply(written: string): string | undefined {
  const m = /__DSH_JS_PROBE_([0-9A-F]+)/.exec(written)
  if (m === null) return undefined
  return (
    '\n__DSH_JS_PROBE_' + m[1] + '\n' +
    'H=web-app-01\nU=root\nP=/root\n' +
    '__DSH_JS_PROBE_END_' + m[1] + '\n' +
    ASSET_PROMPT
  )
}

export function doneReply(written: string): string | undefined {
  const m = /__DSH_JS_DONE_([0-9A-F]+)/.exec(written)
  if (m === null) return undefined
  const out = 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   12G   36G  25% /\n'
  return out + '\n__DSH_JS_DONE_' + m[1] + ':0\n' + ASSET_PROMPT
}

export function sessionConfig(wireFactory: () => Promise<FakeWire>) {
  return {
    host: '203.0.113.10',
    port: 2222,
    username: 'ops',
    password: 'secret',
    connectTimeoutMs: 2000,
    enterAssetMs: 2000,
    probeMs: 1500,
    commandMs: 3000,
    leaveMs: 2000,
    listAssetsMs: 2000,
    wireFactory,
  }
}
