import { describe, expect, it } from 'vitest'
import { isReadOnlyAllowed } from '../src/security/command-classifier.js'
import { allProfileCommands, detectAppIds, linuxCommands, profileCommands, resolveProfile, sanitizeSince } from '../src/ops/profiles.js'
import { compareCommands, parseDfRoot, parseFreeMem, parseUptime } from '../src/ops/collect.js'

describe('V0.3.0 profiles: every command is READ (approval-free triage)', () => {
  it('every profile command classifies as READ', () => {
    const fails: string[] = []
    for (const cmd of allProfileCommands()) {
      const r = isReadOnlyAllowed(cmd)
      if (!r.allowed) fails.push(cmd + ' -> ' + (r.reason ?? 'not read'))
    }
    expect(fails).toEqual([])
  })

  it('linuxCommands + profileCommands cover the always-run sweep', () => {
    expect(linuxCommands('30m').length).toBeGreaterThan(20)
    const nginx = resolveProfile('nginx')
    expect(nginx).toBeDefined()
    const windowed = profileCommands(nginx!, '2h')
    expect(windowed.some((c) => c.command.includes('--since 2h'))).toBe(true)
    for (const c of windowed) expect(c.command).not.toContain('%SINCE%')
  })
})

describe('V0.3.0 app detection', () => {
  it('detectAppIds finds nginx/java from the detection sweep text', () => {
    const text = 'nginx\nsshd\njava\n' + 'nginx.service loaded active running\n' + 'LISTEN 0.0.0.0:80 users:(("nginx",pid=1,fd=6))\n'
    const ids = detectAppIds(text)
    expect(ids).toContain('nginx')
    expect(ids).toContain('java')
  })

  it('docker/kubelet markers are recognised', () => {
    expect(detectAppIds('dockerd\nkubelet\n')).toEqual(expect.arrayContaining(['docker', 'kubernetes']))
    expect(detectAppIds('sshd only')).toEqual([])
  })
})

describe('V0.3.0 metric parsers', () => {
  it('parseUptime extracts load averages', () => {
    expect(parseUptime(' 10:00:00 up 13 days,  2 users,  load average: 1.02, 0.98, 0.95')).toEqual({ load1: 1.02, load5: 0.98, load15: 0.95 })
    expect(parseUptime('no load line')).toEqual({ load1: null, load5: null, load15: null })
  })

  it('parseFreeMem computes used % from available', () => {
    const text = '             total        used        free      shared  buff/cache   available\nMem:          15952       14820         300          12         832         900\nSwap:         8192         100        8092\n'
    const m = parseFreeMem(text)
    expect(m.totalMb).toBe(15952)
    expect(m.usedPct).toBe(94)
  })

  it('parseDfRoot finds the root filesystem use %', () => {
    const text = 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sda1        50G   45G  3.3G  94% /\n/dev/sdb1       100G   20G   75G  22% /data\n'
    expect(parseDfRoot(text)).toBe(94)
  })

  it('compareCommands are all READ and carry a since window', () => {
    for (const c of compareCommands('30m')) {
      expect(isReadOnlyAllowed(c.command).allowed, c.command).toBe(true)
    }
    expect(compareCommands('2h').some((c) => c.command.includes('--since 2h'))).toBe(true)
  })
})

describe('V0.3.0 since sanitization', () => {
  it('sanitizeSince accepts bounded values and falls back to 30m', () => {
    expect(sanitizeSince('10m')).toBe('10m')
    expect(sanitizeSince('2h')).toBe('2h')
    expect(sanitizeSince('2026-09-01')).toBe('2026-09-01')
    expect(sanitizeSince('rm -rf /')).toBe('30m')
    expect(sanitizeSince(undefined)).toBe('30m')
  })
})
