import { describe, expect, it } from 'vitest'
import { parseMemory } from '../src/jumpserver/host-parse.js'

/**
 * `free` localises its row labels. On a zh_CN host (the JumpServer target) the
 * memory row is 内存: and never Mem:, so an English-only match reported
 * memoryTotalMb: null on every such system - a silent miss, not an error.
 */
const COLUMNS = '               total        used        free      shared  buff/cache   available'
const ZH = [
  COLUMNS,
  '内存：      15989        2946        1096          70       11946       12633',
  '交换：       4095         132        3963',
].join('\n')
const EN = [
  COLUMNS,
  'Mem:           15782        3020        1486          70        11276        12576',
  'Swap:           4096         131        3965',
].join('\n')

describe('parseMemory', () => {
  it('reads the English Mem row', () => {
    const out = parseMemory(EN)
    expect(out.totalMb).toBe(15782)
    expect(out.usedMb).toBe(3020)
    expect(out.availableMb).toBe(12576)
  })

  it('reads the zh_CN row exactly as the target host prints it', () => {
    const out = parseMemory(ZH)
    expect(out.totalMb).toBe(15989)
    expect(out.usedMb).toBe(2946)
    expect(out.availableMb).toBe(12633)
    expect(out.usedPct).toBe(18)
  })

  it('does not read the swap row as memory', () => {
    expect(parseMemory(ZH).totalMb).not.toBe(4095)
  })

  it('returns nulls rather than guessing when there is no memory row', () => {
    expect(parseMemory('free: command not found').totalMb).toBeNull()
  })
})
