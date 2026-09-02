import { describe, expect, it } from 'vitest'
import { canTransition, nextState, SessionState } from '../src/jumpserver/state-machine.js'

describe('state machine legal transitions', () => {
  it('covers the required V0.1 flow', () => {
    expect(nextState(SessionState.DISCONNECTED, SessionState.CONNECTING)).toBe(SessionState.CONNECTING)
    expect(nextState(SessionState.CONNECTING, SessionState.JUMPSERVER_MENU)).toBe(SessionState.JUMPSERVER_MENU)
    expect(nextState(SessionState.JUMPSERVER_MENU, SessionState.ENTERING_ASSET)).toBe(SessionState.ENTERING_ASSET)
    expect(nextState(SessionState.ENTERING_ASSET, SessionState.ASSET_SHELL)).toBe(SessionState.ASSET_SHELL)
    expect(nextState(SessionState.ASSET_SHELL, SessionState.COMMAND_RUNNING)).toBe(SessionState.COMMAND_RUNNING)
    expect(nextState(SessionState.COMMAND_RUNNING, SessionState.ASSET_SHELL)).toBe(SessionState.ASSET_SHELL)
    expect(nextState(SessionState.ASSET_SHELL, SessionState.JUMPSERVER_MENU)).toBe(SessionState.JUMPSERVER_MENU)
  })

  it('collapses illegal transitions to UNKNOWN (never guesses)', () => {
    expect(nextState(SessionState.JUMPSERVER_MENU, SessionState.COMMAND_RUNNING)).toBe(SessionState.UNKNOWN)
    expect(nextState(SessionState.ASSET_SHELL, SessionState.ENTERING_ASSET)).toBe(SessionState.UNKNOWN)
    expect(nextState(SessionState.DISCONNECTED, SessionState.ASSET_SHELL)).toBe(SessionState.UNKNOWN)
    expect(nextState(SessionState.CONNECTING, SessionState.ASSET_SHELL)).toBe(SessionState.UNKNOWN)
    expect(nextState(SessionState.ENTERING_ASSET, SessionState.JUMPSERVER_MENU)).toBe(SessionState.UNKNOWN)
    expect(nextState(SessionState.COMMAND_RUNNING, SessionState.JUMPSERVER_MENU)).toBe(SessionState.UNKNOWN)
  })

  it('allows recovery sinks from UNKNOWN/ERROR', () => {
    expect(canTransition(SessionState.UNKNOWN, SessionState.DISCONNECTED)).toBe(true)
    expect(canTransition(SessionState.UNKNOWN, SessionState.CONNECTING)).toBe(true)
    expect(canTransition(SessionState.ERROR, SessionState.DISCONNECTED)).toBe(true)
    expect(canTransition(SessionState.ERROR, SessionState.ASSET_SHELL)).toBe(false)
  })
})
