import { describe, expect, it } from 'vitest'
import { sanitizeToolOutput, toLosslessJsonValue } from '../src/tools/common.js'

describe('lossless JSON tool outputs', () => {
  it('recursively sanitizes unsupported JSON values', () => {
    const error = Object.assign(new Error('boom'), { code: 'E_TEST' })
    const value = sanitizeToolOutput({ missing: undefined, finite: 2, nan: Number.NaN, inf: Infinity, ninf: -Infinity, bigint: 42n, date: new Date('2026-09-03T00:00:00.000Z'), map: new Map([['x', 1]]), set: new Set(['a', 'b']), error, array: [1, undefined] }) as Record<string, unknown>
    expect(value).not.toHaveProperty('missing')
    expect(value).toMatchObject({ finite: 2, nan: null, inf: null, ninf: null, bigint: '42', date: '2026-09-03T00:00:00.000Z', map: { x: 1 }, set: ['a', 'b'], error: { name: 'Error', message: 'boom', code: 'E_TEST' }, array: [1, null] })
    expect(() => JSON.parse(JSON.stringify(value))).not.toThrow()
  })

  it.each([
    { ok: true, hostname: undefined, exitCode: null, commands: [], evidence: [] },
    { ok: false, code: 'COMMAND_TIMEOUT', hostname: null, metrics: { load1: Number.NaN } },
    { ok: true, targets: ['a'], metrics: new Map([['load1', null]]), findings: [] },
    { ok: false, code: 'FAILED_PROFILE', error: new Error('profile failed') },
  ])('round-trips partial ops fixture %#', (fixture) => {
    const value = toLosslessJsonValue(fixture)
    const json = JSON.stringify(value)
    expect(() => JSON.parse(json)).not.toThrow()
    expect(JSON.stringify(JSON.parse(json))).toBe(json)
  })
})
