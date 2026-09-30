import { describe, expect, it } from 'vitest'
import { emptyOutputNote } from '../src/tools/common.js'

/**
 * A PTY's canonical line discipline caps one line at roughly 4KB, so a large
 * single-line response is discarded by the far end while the command exits 0:
 *
 *   curl -s http://host/api/v1/alerts | wc -c   -> 41613
 *   curl -s http://host/api/v1/alerts           -> (empty, exit 0)
 *
 * That reads exactly like "the command ran and printed nothing", which is the
 * wrong conclusion. The result must say so instead.
 */
describe('emptyOutputNote', () => {
  it('explains an empty exit-0 result instead of leaving it silent', () => {
    const note = emptyOutputNote('curl -s http://127.0.0.1:9090/api/v1/alerts', '', 0)
    expect(note).toBeDefined()
    expect(note).toMatch(/4KB/)
    expect(note).toMatch(/jq|fold|head/)
  })

  it('stays silent when the command produced output', () => {
    expect(emptyOutputNote('hostname', 'app-01', 0)).toBeUndefined()
    expect(emptyOutputNote('uptime', ' 19:50:07 up 601 days', 0)).toBeUndefined()
  })

  it('stays silent for commands that legitimately print nothing', () => {
    for (const cmd of ['true', ':', 'cd /tmp', 'export X=1', 'stty -echo']) {
      expect(emptyOutputNote(cmd, '', 0)).toBeUndefined()
    }
  })

  it('stays silent on a non-zero exit (the real error is reported instead)', () => {
    expect(emptyOutputNote('cat /nope', '', 1)).toBeUndefined()
    expect(emptyOutputNote('cat /nope', '', null)).toBeUndefined()
  })

  it('looks past a pipeline prefix to judge the producer', () => {
    expect(emptyOutputNote('true | wc -c', '', 0)).toBeUndefined()
    expect(emptyOutputNote('curl -s http://h/api | jq .', '', 0)).toBeDefined()
  })
})
