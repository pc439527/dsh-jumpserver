import { describe, expect, it } from 'vitest'
import { ScreenDetector } from '../src/jumpserver/detector.js'
import { ASSET_PROMPT, KOKO_MENU } from './helpers.js'

describe('screen detector', () => {
  it('detects the KoKo menu', () => {
    const d = new ScreenDetector()
    d.push(KOKO_MENU)
    expect(d.detect()).toBe('JUMPSERVER_MENU')
  })

  it('detects an asset shell prompt, not a menu', () => {
    const d = new ScreenDetector()
    d.push(ASSET_PROMPT)
    expect(d.detect()).toBe('ASSET_SHELL')
  })

  it('treats a broken-up buffer as one screen', () => {
    const d = new ScreenDetector()
    for (const fragment of [KOKO_MENU.slice(0, 30), KOKO_MENU.slice(30, 90), KOKO_MENU.slice(90)]) d.push(fragment)
    expect(d.detect()).toBe('JUMPSERVER_MENU')
  })

  it('survives ANSI control sequences in the stream', () => {
    const d = new ScreenDetector()
    d.push(KOKO_MENU.replace(/\./g, '_').replace(/│/g, '│\x1b[1;32m'))
    d.push('\x1b[0m')
    expect(d.detect()).toBe('JUMPSERVER_MENU')
  })

  it('returns undefined on unrelated output', () => {
    const d = new ScreenDetector()
    d.push('Loading kernel ...\nStarting services...\n')
    expect(d.detect()).toBeUndefined()
  })
})
