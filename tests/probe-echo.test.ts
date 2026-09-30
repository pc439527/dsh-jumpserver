import { describe, expect, it } from 'vitest'
import { applyProbe, emptyInventory, parseHostname, stripCommandEcho } from '../src/jumpserver/host-parse.js'

/**
 * A PTY echoes the command before its output, so a probe's captured text
 * normally STARTS with the command line. Parsers that read the first line or
 * coerce the whole text therefore reported the COMMAND as the value:
 *
 *   hostname -> "hostname"   (real: ubtsvr)
 *   uname -r -> "uname -r"   (real: 5.15.0-131-generic)
 *   nproc    -> Number("nproc") = NaN -> cores: null
 *   free -m  -> memory never matched -> memoryTotalMb: null
 *
 * Parsers that SEARCH the whole text (os-release, uptime) survived, which is
 * why only some fields degraded. Strip the echo before parsing instead.
 */
const REAL = {
  hostname: 'ubtsvr',
  kernel: '5.15.0-131-generic',
  nproc: '4',
  free: [
    '               total        used        free      shared  buff/cache   available',
    'Mem:           15Gi       2.9Gi       1.4Gi        70Mi        11Gi        12Gi',
    'Swap:          4.0Gi       131Mi       3.9Gi',
  ].join('\n'),
}

/** What the PTY actually delivers: the echo, then the real output. */
function echoed(command: string, body: string): string {
  return command + '\r\n\r' + body + '\r\n'
}

describe('probe output echo', () => {
  it('stripCommandEcho removes the echoed command and keeps the real output', () => {
    const out = stripCommandEcho(echoed('hostname', REAL.hostname), 'hostname')
    expect(out).not.toContain('hostname\r')
    expect(out.trim()).toBe(REAL.hostname)
  })

  it('leaves output alone when the first line is not the command', () => {
    const body = 'something else\nubtsvr'
    expect(stripCommandEcho(body, 'hostname').trim()).toBe(body)
  })

  it('is a no-op for empty output', () => {
    expect(stripCommandEcho('', 'hostname')).toBe('')
  })

  it('parses a real hostname instead of the command', () => {
    const inv = emptyInventory('192.168.30.53', [])
    applyProbe(inv, 'hostname', stripCommandEcho(echoed('hostname', REAL.hostname), 'hostname'), 0)
    expect(inv.hostname).toBe(REAL.hostname)
    expect(inv.hostname).not.toBe('hostname')
  })

  it('parses kernel, cores and memory from echoed output', () => {
    const inv = emptyInventory('192.168.30.53', [])
    applyProbe(inv, 'kernel', stripCommandEcho(echoed('uname -r', REAL.kernel), 'uname -r'), 0)
    applyProbe(inv, 'nproc', stripCommandEcho(echoed('nproc', REAL.nproc), 'nproc'), 0)
    applyProbe(inv, 'memory', stripCommandEcho(echoed('free -m', REAL.free), 'free -m'), 0)
    expect(inv.kernel).toBe(REAL.kernel)
    expect(inv.cores).toBe(4)
    expect(inv.memory.totalMb).toBeGreaterThan(0)
  })

  it('never reports the command text as a field value on the wired path', () => {
    const inv = emptyInventory('192.168.30.53', [])
    // The inspector now passes the command, so the echo is removed before any
    // parser sees it — the exact values the field previously reported.
    applyProbe(inv, 'hostname', echoed('hostname', REAL.hostname), 0, 'hostname')
    applyProbe(inv, 'kernel', echoed('uname -r', REAL.kernel), 0, 'uname -r')
    applyProbe(inv, 'nproc', echoed('nproc', REAL.nproc), 0, 'nproc')
    expect(inv.hostname).not.toBe('hostname')
    expect(inv.kernel).not.toBe('uname -r')
    expect(inv.cores).toBe(4)
  })

  it('parseHostname itself ignores a prompt line', () => {
    expect(parseHostname('[root@ubtsvr:~]# hostname\nubtsvr\n')).toBe('ubtsvr')
  })
})
