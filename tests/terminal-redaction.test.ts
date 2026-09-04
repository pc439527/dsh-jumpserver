import { describe, expect, it } from 'vitest'
import { TerminalObserver } from '../src/jumpserver/terminal-observer.js'
import { applySnapshot, createTerminalBuffer } from '../src/client/terminal-view.js'

describe('terminal safety and noise filtering', () => {
  it('redacts secrets before terminal events are retained', () => {
    const observer = new TerminalObserver(500)
    observer.recordInput('mysql -uroot -psecret -e "SELECT 1"')
    observer.recordOutput('root@demo:~# mysql -uroot -psecret -e "SELECT 1"\r\n')
    const text = JSON.stringify(observer.snapshot())
    expect(text).not.toContain('psecret')
    expect(text).toContain('p******')
  })

  it('hides internal completion helper fragments and per-command transient states', () => {
    const buffer = createTerminalBuffer(500)
    const snapshot = {
      ok: true,
      lastSeq: 4,
      oldestSeq: 1,
      events: [
        { seq: 1, timestamp: 1, type: 'state' as const, state: 'COMMAND_RUNNING' },
        { seq: 2, timestamp: 2, type: 'output' as const, data: "root@demo:~# printf '\r\n" },
        { seq: 3, timestamp: 3, type: 'state' as const, state: 'ASSET_SHELL' },
        { seq: 4, timestamp: 4, type: 'output' as const, data: 'actual result\r\n' },
      ],
    } as any
    applySnapshot(buffer, snapshot, 0)
    const rendered = JSON.stringify(buffer.rows)
    expect(rendered).not.toContain("printf '")
    expect(rendered).not.toContain('Running command')
    expect(rendered).not.toContain('Asset shell')
    expect(rendered).toContain('actual result')
  })
})
