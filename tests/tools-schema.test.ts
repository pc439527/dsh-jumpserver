import { describe, expect, it } from 'vitest'
import { valueSchemaSpecToJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { ASSETS_SCHEMA } from '../src/tools/definitions.js'
import { RESULT_SCHEMA, assetsToValue, statusToValue, execOutcomeToValue, renderBatchResult } from '../src/tools/common.js'
import { SessionState } from '../src/jumpserver/state-machine.js'

function assertValid(value: Record<string, unknown>, label: string): void {
  const schema = valueSchemaSpecToJsonSchema(RESULT_SCHEMA)
  const violations = validateJsonSchemaValue(schema, value, 'value')
  expect(violations, label + ' violations: ' + violations.join('; ')).toEqual([])
}

const baseStatus = {
  state: SessionState.JUMPSERVER_MENU,
  gateway: '203.0.113.10:2222',
  target: null as string | null,
  hostname: null as string | null,
  user: null as string | null,
  pwd: null as string | null,
  connected: false,
  permissionMode: 'READ_ONLY',
  configured: true,
  connectedAt: null,
  lastActivityAt: null,
  reconnectCount: 0,
}

describe('tool output schema contract (harness validator)', () => {
  it('disconnected status omits null fields and validates', () => {
    const value = statusToValue({ ...baseStatus, state: SessionState.DISCONNECTED })
    expect(value.target).toBeUndefined()
    expect(value.hostname).toBeUndefined()
    assertValid(value, 'disconnected')
  })

  it('menu status validates', () => {
    assertValid(statusToValue({ ...baseStatus, state: SessionState.JUMPSERVER_MENU }), 'menu')
  })

  it('asset-shell status with target+hostname validates', () => {
    const value = statusToValue({
      ...baseStatus,
      state: SessionState.ASSET_SHELL,
      target: '203.0.113.101',
      hostname: 'web-app-01',
      user: 'root',
      pwd: '/root',
    })
    expect(value.target).toBe('203.0.113.101')
    assertValid(value, 'asset-shell')
  })

  it('completed exec outcome validates (includes output + exitCode)', () => {
    const value = execOutcomeToValue(
      { ...baseStatus, state: SessionState.ASSET_SHELL, target: '203.0.113.101', hostname: 'web-app-01' },
      { kind: 'completed', exitCode: 0, commandStatus: 'SUCCESS', output: 'hostname\nweb-app-01', truncated: false, durationMs: 123, executionState: 'COMPLETED' },
    )
    assertValid(value, 'completed')
  })

  it('timeout outcome validates', () => {
    const value = execOutcomeToValue(
      { ...baseStatus, state: SessionState.ASSET_SHELL, target: '203.0.113.101', hostname: 'web-app-01' },
      { kind: 'timeout', commandStatus: 'TIMEOUT', output: 'partial', truncated: true, durationMs: 5000, executionState: 'TIMEOUT' },
    )
    assertValid(value, 'timeout')
  })

  it('signal-lost outcome validates (target/hostname may be null here -> omitted)', () => {
    const value = execOutcomeToValue(
      { ...baseStatus, state: SessionState.UNKNOWN },
      { kind: 'signal-lost', commandStatus: 'CONNECTION_LOST', output: '', durationMs: 42, executionState: 'UNKNOWN' },
    )
    assertValid(value, 'signal-lost')
  })
})

describe('jumpserver_assets result contract (V0.2.4)', () => {
  it('assetsToValue with pipe rows + health validates against ASSETS_SCHEMA', async () => {
    const value = assetsToValue({
      assets: [
        {
          index: 151,
          name: 's113181_BI节点2',
          ip: '203.0.113.181',
          platform: 'Linux',
          node: '示例单位',
          comment: null,
          raw: '151 | s113181_BI节点2 | 203.0.113.181 | Linux | 示例单位',
        },
      ],
      count: 1,
      filter: null,
      truncated: false,
      paged: false,
      rawText: '151 | s113181_BI节点2 | 203.0.113.181 | Linux | 示例单位\r\nOpt> ',
      rawRows: 1,
      parsedRows: 1,
      page: 1,
      pageSize: 171,
      totalPages: 1,
      reportedTotal: 171,
      complete: true,
      group: null,
      groupMatched: 0,
      health: 'ok',
    })
    const schema = valueSchemaSpecToJsonSchema(ASSETS_SCHEMA)
    const violations = validateJsonSchemaValue(schema, value, 'value')
    expect(violations).toEqual([])
    expect(value.health).toBe('ok')
    expect((value.assets as Array<Record<string, unknown>>)[0]?.platform).toBe('Linux')
  })

  it('ASSETS_SCHEMA alone accepts the not-armed error shape', () => {
    const schema = valueSchemaSpecToJsonSchema(ASSETS_SCHEMA)
    const violations = validateJsonSchemaValue(
      schema,
      { ok: false, code: 'JUMPSERVER_NOT_ARMED', message: 'locked' },
      'value',
    )
    expect(violations).toEqual([])
  })
})

describe('jumpserver_batch result contract (V0.2)', () => {
  it('renderBatchResult validates against the shared RESULT_SCHEMA', () => {
    const value = renderBatchResult([
      {
        target: '203.0.113.101',
        hostname: 'web-app-01',
        error: null,
        commands: [
          {
            command: 'hostname',
            executionState: 'COMPLETED',
            commandStatus: 'SUCCESS',
            exitCode: 0,
            output: 'web-app-01\n',
            truncated: false,
            durationMs: 12,
            error: null,
          },
        ],
      },
      {
        target: '203.0.113.102',
        hostname: null,
        error: { code: 'ASSET_ENTER_TIMEOUT', message: 'asset shell for 203.0.113.102 was not detected within the enter timeout' },
        commands: [],
      },
    ])
    expect(value.ok).toBe(false)
    assertValid(value, 'batch-with-failure')
    expect(String(value.output)).toContain('target=203.0.113.101')
    expect(String(value.output)).toContain('error=ASSET_ENTER_TIMEOUT')
  })
})
