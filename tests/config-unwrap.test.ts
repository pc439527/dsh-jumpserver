import { describe, expect, it } from 'vitest'
import { createVolatile } from '@deepseek-ai/cosmokit'
import { unwrapConfig } from '../src/config/types.js'

/**
 * Every Config field is `.volatile()` so the Host serves this plugin's
 * namespace. A volatile field parses into a Volatile REFERENCE, so plugin code
 * reading config directly sees `[object Object]` instead of the value - which
 * surfaced as "password is not configured (set [object Object])" and a
 * gateway of "[object Object]:[object Object]". These pin the unwrapping.
 */
describe('unwrapConfig', () => {
  it('resolves a volatile scalar to its plain value', () => {
    const wrapped = createVolatile('203.0.113.10') as unknown as string
    expect(String(wrapped)).not.toBe('203.0.113.10')
    expect(unwrapConfig(wrapped)).toBe('203.0.113.10')
  })

  it('resolves a whole volatile config object field by field', () => {
    const raw = {
      host: createVolatile('203.0.113.10') as unknown as string,
      port: createVolatile(2222) as unknown as number,
      username: createVolatile('ops') as unknown as string,
      passwordEnv: createVolatile('JS_PASSWORD') as unknown as string,
    }
    expect(unwrapConfig(raw)).toEqual({
      host: '203.0.113.10',
      port: 2222,
      username: 'ops',
      passwordEnv: 'JS_PASSWORD',
    })
  })

  it('unwraps volatile entries nested in arrays and objects', () => {
    const raw = {
      allowedTargets: [createVolatile('10.0.0.0/8') as unknown as string],
      nested: { inner: createVolatile('x') as unknown as string },
    }
    expect(unwrapConfig(raw)).toEqual({
      allowedTargets: ['10.0.0.0/8'],
      nested: { inner: 'x' },
    })
  })

  it('leaves plain values and absent fields untouched', () => {
    expect(unwrapConfig({ host: 'plain', port: 22 })).toEqual({ host: 'plain', port: 22 })
    expect(unwrapConfig(undefined)).toBeUndefined()
  })
})
