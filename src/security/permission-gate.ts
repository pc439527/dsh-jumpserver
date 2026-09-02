import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import type { CommandRisk } from '../config/types.js'
import { JumpServerError } from '../jumpserver/errors.js'
import type { SessionManager } from '../jumpserver/session-manager.js'
import { classifyCommand, gateDecision, requireTargetVerified } from './permission.js'

export interface GateServices {
  getConfig: () => { permissionMode: 'READ_ONLY' | 'AUTO' | 'FULL_ACCESS' }
  manager: SessionManager
  approval?: ApprovalService
}

export interface GatedCommand {
  risk: CommandRisk
  /** Runs right after navigation (run tool): verify target, then ask. */
  beforeExec?: () => Promise<void>
}

async function askApproval(services: GateServices, exec: ToolRunContext, command: string, risk: CommandRisk): Promise<void> {
  const approval = services.approval
  if (approval === undefined) {
    throw new JumpServerError('COMMAND_APPROVAL_REQUIRED', 'approval service unavailable; the command was not executed')
  }
  if (exec.agent === undefined) {
    throw new JumpServerError('COMMAND_APPROVAL_REQUIRED', 'no agent to route approval through; the command was not executed')
  }
  const status = services.manager.status()
  const reason =
    '目标服务器：' +
    (status.target ?? '?') +
    ' / ' +
    (status.hostname ?? 'unknown host') +
    '\n准备执行：' +
    command +
    '\n风险等级：' +
    risk +
    '\n该操作会修改远程服务器运行状态。是否执行？'
  const outcome = await approval.request({
    agent: exec.agent,
    toolName: exec.name,
    callId: exec.callId,
    reason,
    signal: exec.signal,
  })
  switch (outcome) {
    case 'allowed-once':
      return
    case 'rejected':
      throw new JumpServerError('COMMAND_BLOCKED', 'the user rejected this command; it was not executed')
    case 'cancelled':
      throw new JumpServerError('COMMAND_BLOCKED', 'approval was cancelled; the command was not executed')
    case 'unavailable':
      throw new JumpServerError('COMMAND_APPROVAL_REQUIRED', 'no approval channel is available; the command was not executed')
  }
}

/** Gate for jumpserver_exec: session is already in ASSET_SHELL. */
export async function gateCommand(services: GateServices, exec: ToolRunContext, command: string): Promise<GatedCommand> {
  const mode = services.getConfig().permissionMode
  const { risk } = classifyCommand(command)
  const decision = gateDecision(risk, mode)
  if (decision.kind === 'allow') return { risk }
  if (risk === 'MODIFY' || risk === 'DANGEROUS') {
    const status = services.manager.status()
    requireTargetVerified({ state: status.state, currentTarget: status.target, currentHostname: status.hostname })
  }
  if (decision.code === 'COMMAND_APPROVAL_REQUIRED') {
    await askApproval(services, exec, command, risk)
    return { risk }
  }
  throw new JumpServerError('COMMAND_BLOCKED', command + ' -- ' + decision.reason)
}

/**
 * Gate for jumpserver_run: navigation happens inside manager.run, so
 * target verification + approval are deferred to a beforeExec hook that runs
 * with the session already inside the requested asset.
 */
export async function gateCommandForNavigation(services: GateServices, exec: ToolRunContext, command: string): Promise<GatedCommand> {
  const mode = services.getConfig().permissionMode
  const { risk } = classifyCommand(command)
  const decision = gateDecision(risk, mode)
  if (decision.kind === 'allow') return { risk }
  if (decision.code === 'COMMAND_BLOCKED') {
    throw new JumpServerError('COMMAND_BLOCKED', command + ' -- ' + decision.reason)
  }
  // ASK path: verify + approve after the session reached the requested asset.
  return {
    risk,
    beforeExec: async () => {
      const status = services.manager.status()
      requireTargetVerified({ state: status.state, currentTarget: status.target, currentHostname: status.hostname })
      await askApproval(services, exec, command, risk)
    },
  }
}
