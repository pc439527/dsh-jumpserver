import { describe, expect, it } from 'vitest'
import { Config } from '../src/config/schema.js'

/**
 * DSH 0.2.x settings contract. The Host's SettingsForms.volatileForm() returns
 * undefined unless at least one Config field declares meta.volatile, and
 * describe() then skips the whole entry: the namespace is never served,
 * configForms.whileServed() never fires, and the settings card silently never
 * mounts - with no error anywhere. These pin the marker so that failure mode
 * cannot come back unnoticed, and assert on the real schemastery `dict` so an
 * empty projection cannot pass vacuously.
 */
describe('Config schema is servable by DSH settings', () => {
  const fields = (): Record<string, { meta?: { volatile?: boolean; role?: string } }> =>
    (Config as unknown as { dict?: Record<string, never> }).dict ?? {}

  it('exposes a non-empty object projection', () => {
    expect(Object.keys(fields()).length).toBeGreaterThan(20)
  })

  it('marks every top-level field volatile', () => {
    const missing = Object.entries(fields())
      .filter(([, child]) => child?.meta?.volatile !== true)
      .map(([key]) => key)
    expect(missing).toEqual([])
  })

  it('still projects the fields the settings card edits', () => {
    for (const field of ['host', 'port', 'username', 'permissionMode', 'consolePort', 'consoleEnabled']) {
      expect(Object.keys(fields())).toContain(field)
    }
  })

  it('keeps the password a redacted secret rather than a plain field', () => {
    expect(fields()['password']?.meta?.role).toBe('secret')
  })
})
