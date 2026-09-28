/**
 * Tool-table budget (V0.5.2, ported): the tools/list payload is a permanent tax
 * on EVERY conversation, including ones that never touch JumpServer. Adding a
 * tool or growing a description is therefore a deliberate cost decision, not a
 * free one — this test freezes the measured size so it cannot drift silently.
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { JumpServerConfig } from '../src/config/types.js'
import type { SessionRegistry } from '../src/jumpserver/session-registry.js'
import { SessionGrant } from '../src/security/grant.js'
import { OpsCaseRegistry } from '../src/ops/evidence.js'
import { JobStore } from '../src/runtime/job-store.js'
import { BaselineStore } from '../src/runtime/baseline-store.js'
import { registerJumpServerTools } from '../src/tools/definitions.js'
import { registerOpsTools } from '../src/tools/ops.js'
import { registerJobTools } from '../src/tools/jobs.js'
import { registerCollectionTools } from '../src/tools/inspection.js'

/** Total schema budget for the whole jumpserver_* surface (bytes of JSON). */
const TOTAL_BUDGET_BYTES = 28 * 1024
/** Per-tool budget (description + parameter schema). */
const PER_TOOL_BUDGET_BYTES = 3 * 1024

interface ToolDef {
  name: string
  description?: string
  parameters?: unknown
}

function config(): JumpServerConfig {
  return {
    enabled: true,
    autoOpenTerminal: true,
    terminalScrollback: 5000,
    host: '203.0.113.10',
    port: 2222,
    username: 'ops',
    passwordEnv: 'JUMPSERVER_PASSWORD',
    connectTimeout: 5,
    commandTimeout: 10,
    idleTimeout: 30,
    permissionMode: 'READ_ONLY',
    autoReconnect: true,
    enableAudit: false,
  }
}

function registeredTools(): ToolDef[] {
  const defs: ToolDef[] = []
  const fakeCtx = {
    tools: { register: (def: ToolDef) => { defs.push(def); return () => undefined } },
    get: () => undefined,
    logger: { debug() {}, warn() {}, info() {} },
  } as unknown as Context
  const registry = {} as unknown as SessionRegistry
  const grants = new SessionGrant()
  const getConfig = (): JumpServerConfig => config()
  registerJumpServerTools(fakeCtx, registry, getConfig, grants)
  registerOpsTools(fakeCtx, registry, getConfig, grants, new OpsCaseRegistry())
  registerJobTools(fakeCtx, registry, getConfig, grants, {} as unknown as JobStore)
  registerCollectionTools(fakeCtx, registry, getConfig, grants, {} as unknown as BaselineStore)
  return defs
}

describe('V0.5.2 tool-table budget', () => {
  const defs = registeredTools()

  it('registers the full documented tool surface', () => {
    expect(defs.map((d) => d.name).sort()).toEqual([
      'jumpserver_assets',
      'jumpserver_audit',
      'jumpserver_baseline_capture',
      'jumpserver_baseline_compare',
      'jumpserver_batch',
      'jumpserver_case',
      'jumpserver_close',
      'jumpserver_compare',
      'jumpserver_connect',
      'jumpserver_enter',
      'jumpserver_exec',
      'jumpserver_inspect',
      'jumpserver_interrupt',
      'jumpserver_job_read',
      'jumpserver_job_start',
      'jumpserver_job_stop',
      'jumpserver_jobs',
      'jumpserver_leave',
      'jumpserver_profile_run',
      'jumpserver_remediate',
      'jumpserver_run',
      'jumpserver_snapshot',
      'jumpserver_status',
      'jumpserver_topology',
      'jumpserver_triage',
    ])
  })

  it('keeps the whole surface inside the schema budget', () => {
    const sizes = defs.map((def) => ({
      name: def.name,
      bytes: Buffer.byteLength(JSON.stringify({ description: def.description ?? '', parameters: def.parameters ?? {} }), 'utf8'),
    }))
    const total = sizes.reduce((sum, entry) => sum + entry.bytes, 0)
    const worst = sizes.slice().sort((a, b) => b.bytes - a.bytes)[0]
    // Printed so a reviewer sees the actual cost of a change, not just pass/fail.
    console.log('tools=' + String(defs.length) + ' total=' + String(total) + 'B worst=' + String(worst?.name) + ' ' + String(worst?.bytes) + 'B')
    expect(total).toBeLessThan(TOTAL_BUDGET_BYTES)
    for (const entry of sizes) {
      expect(entry.bytes, entry.name + ' exceeds the per-tool schema budget').toBeLessThan(PER_TOOL_BUDGET_BYTES)
    }
  })

  it('every tool declares a description and a parameter schema', () => {
    for (const def of defs) {
      expect((def.description ?? '').length, def.name).toBeGreaterThan(40)
      expect(def.parameters, def.name).toBeDefined()
    }
  })
})
