import { describe, expect, it } from 'vitest'
import { cleanAnsi, MarkerWatcher, stripMarkerLines } from '../src/jumpserver/output-buffer.js'
import { parseDoneLine, buildDoneScript, DONE_PREFIX } from '../src/jumpserver/command-runner.js'
import { parseProbeOutput } from '../src/jumpserver/probe.js'

describe('output normalization', () => {
  it('strips ANSI and normalizes CRLF', () => {
    expect(cleanAnsi('\x1b[32mgreen\x1b[0m\r\nnext\r')).toBe('green\nnext\n')
    expect(cleanAnsi('\x1b]0;title\x07body')).toBe('body')
  })

  it('caps output at the limit and marks truncated', () => {
    const w = new MarkerWatcher('__X__', 100)
    w.push('a'.repeat(60))
    w.push('b'.repeat(60))
    expect(w.buffer.truncated).toBe(true)
    const { text } = w.buffer.take()
    expect(text.length).toBeLessThanOrEqual(120)
    expect(text.endsWith('bbbb')).toBe(true)
  })

  it('matches a marker split across many fragments', () => {
    const w = new MarkerWatcher('__DSH_JS_DONE_ABCDEF12:0', 4096)
    const fragments = ['__DSH_JS_', 'DONE_AB', 'CDEF', '12', ':0']
    let hit = false
    for (const f of fragments) hit = w.push(f) || hit
    expect(w.matched()).toBe(true)
    expect(hit).toBe(true)
  })

  it('does not fire on a partial marker before it completes', () => {
    const w = new MarkerWatcher('__DSH_JS_DONE_ABCD:0', 4096)
    w.push('__DSH_JS_DONE_ABC')
    expect(w.matched()).toBe(false)
    w.push('D:0')
    expect(w.matched()).toBe(true)
  })

  it('strips our own marker lines only', () => {
    const text = 'one\n__DSH_JS_DONE_XXXX:0\nthree'
    expect(stripMarkerLines(text, DONE_PREFIX + 'XXXX')).toBe('one\nthree')
    expect(stripMarkerLines(text, DONE_PREFIX + 'YYYY')).toBe(text)
  })
})

describe('done marker parsing', () => {
  it('extracts the real exit code', () => {
    const marker = 'A81C3F'
    const script = buildDoneScript('df -h', marker)
    expect(script).toContain('df -h')
    expect(script).toContain('__dsh_rc=$?')
    const reply = 'Filesystem 1K-blocks\n/dev/sda1 123\n\n' + DONE_PREFIX + marker + ':0\n'
    expect(parseDoneLine(reply, marker)).toEqual({ exitCode: 0 })
    expect(parseDoneLine(reply + 'garbage', 'OTHER')).toBeNull()
  })
})

describe('probe parsing', () => {
  it('returns hostname/user/pwd from labeled lines', () => {
    const marker = 'A8F31C'
    const raw =
      'some banner\n' +
      '__DSH_JS_PROBE_' + marker + '\nH=web-app-01\nU=root\nP=/root\n' +
      '__DSH_JS_PROBE_END_' + marker + '\n[root@web-app-01 ~]# '
    expect(parseProbeOutput(raw, marker)).toEqual({ hostname: 'web-app-01', user: 'root', pwd: '/root' })
  })

  it('is robust to command echo and continuation-prompt interleaving', () => {
    const marker = 'B9C21D'
    const raw =
      "[root@web-app-01 ~]# printf '__DSH_JS_PROBE_" + marker + "'\n\n" +
      '__DSH_JS_PROBE_' + marker + '\n' +
      "[root@web-app-01 ~]# printf 'H=%s\n> ' \n" +
      'H=web-app-01\nU=root\nP=/root\n' +
      '__DSH_JS_PROBE_END_' + marker + '\n[root@web-app-01 ~]# '
    expect(parseProbeOutput(raw, marker)).toEqual({ hostname: 'web-app-01', user: 'root', pwd: '/root' })
  })

  it('returns null when verification data is missing', () => {
    const marker = 'A8F31C'
    expect(parseProbeOutput('no marker at all', marker)).toBeNull()
    expect(
      parseProbeOutput('__DSH_JS_PROBE_' + marker + '\nH=host\nU=user\n__DSH_JS_PROBE_END_' + marker, marker),
    ).toBeNull()
  })
})
