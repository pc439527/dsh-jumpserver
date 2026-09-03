import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import type { CommandRisk, PermissionMode } from '../config/types.js'
import { JumpServerError } from '../jumpserver/errors.js'
import type { SessionManager } from '../jumpserver/session-manager.js'
import { classifyCommand, gateDecision, requireTargetVerified, type Classification } from './permission.js'

export interface GateServices {
  getConfig: () => { permissionMode: PermissionMode; privilegedReadInReadOnly?: boolean }
  manager: SessionManager
  approval?: ApprovalService
}

export interface GatedCommand {
  risk: CommandRisk
  /** Full V0.3.1 classification (ruleId/reason/confidence) — audit + approval copy. */
  classification: Classification
  /** True when this gated command required a human approval (for the audit). */
  approvalRequired: boolean
  /** Runs right after navigation (run tool): verify target, then ask. */
  beforeExec?: () => Promise<void>
}

/** V0.3.1: approval copy is risk-honest — UNKNOWN is never presented as MODIFY. */
function approvalReason(status: { target: string | null; hostname: string | null }, command: string, classification: Classification): string {
  const target = '目标服务器：' + (status.target ?? '?') + ' / ' + (status.hostname ?? 'unknown host')
  const lines: string[] = [target, '准备执行：' + command, '']
  switch (classification.risk) {
    case 'UNKNOWN':
      lines.push('风险：无法确认该命令是否为只读（规则 ' + classification.ruleId + '）')
      lines.push('原因：当前分类器没有该命令的语义规则，不能确认它是否修改服务器。')
      lines.push('这不代表命令一定会修改服务器——是否允许本次执行？')
      break
    case 'MODIFY':
      lines.push('风险：修改操作（规则 ' + classification.ruleId + '）')
      lines.push('原因：' + (classification.reason || '识别为修改命令') + '。')
      lines.push('该命令会改变服务器运行状态，是否执行？')
      break
    case 'DANGEROUS':
      lines.push('风险：高危操作（规则 ' + classification.ruleId + '）')
      lines.push('原因：该命令可能造成服务中断、数据破坏或系统不可用。')
      lines.push('是否仍然执行？')
      break
    case 'PRIVILEGED_READ':
      lines.push('风险：特权只读（需要 sudo/root，规则 ' + classification.ruleId + '）')
      lines.push('原因：' + (classification.reason || 'privileged read') + '。')
      lines.push('是否允许本次执行？')
      break
    default:
      lines.push('风险：' + classification.risk + '（规则 ' + classification.ruleId + '）')
      lines.push('原因：' + (classification.reason || '') + '。是否执行？')
  }
  return lines.join('\n')
}

async function askApproval(services: GateServices, exec: ToolRunContext, command: string, classification: Classification): Promise<void> {
  const approval = services.approval
  if (approval === undefined) {
    throw new JumpServerError('COMMAND_APPROVAL_REQUIRED', 'approval service unavailable; the command was not executed')
  }
  if (exec.agent === undefined) {
    throw new JumpServerError('COMMAND_APPROVAL_REQUIRED', 'no agent to route approval through; the command was not executed')
  }
  const status = services.manager.status()
  const reason = approvalReason(status, command, classification)
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

function verifyTarget(services: GateServices): void {
  const status = services.manager.status()
  requireTargetVerified({ state: status.state, currentTarget: status.target, currentHostname: status.hostname })
}

/** Gate for jumpserver_exec: session is already in ASSET_SHELL. */
export async function gateCommand(services: GateServices, exec: ToolRunContext, command: string): Promise<GatedCommand> {
  const cfg = services.getConfig()
  const classification = classifyCommand(command)
  const decision = gateDecision(classification.risk, cfg.permissionMode, { privilegedReadInReadOnly: cfg.privilegedReadInReadOnly })
  if (decision.kind === 'allow') return { risk: classification.risk, classification, approvalRequired: false }
  if (classification.risk === 'MODIFY' || classification.risk === 'DANGEROUS' || classification.risk === 'UNKNOWN') {
    verifyTarget(services)
  }
  if (decision.code === 'COMMAND_APPROVAL_REQUIRED') {
    await askApproval(services, exec, command, classification)
    return { risk: classification.risk, classification, approvalRequired: true }
  }
  throw new JumpServerError('COMMAND_BLOCKED', command + ' -- ' + decision.reason)
}

/**
 * Gate for jumpserver_run: navigation happens inside manager.run, so
 * target verification + approval are deferred to a beforeExec hook that runs
 * with the session already inside the requested asset.
 */
export async function gateCommandForNavigation(services: GateServices, exec: ToolRunContext, command: string): Promise<GatedCommand> {
  const cfg = services.getConfig()
  const classification = classifyCommand(command)
  const decision = gateDecision(classification.risk, cfg.permissionMode, { privilegedReadInReadOnly: cfg.privilegedReadInReadOnly })
  if (decision.kind === 'allow') return { risk: classification.risk, classification, approvalRequired: false }
  if (decision.code === 'COMMAND_BLOCKED') {
    throw new JumpServerError('COMMAND_BLOCKED', command + ' -- ' + decision.reason)
  }
  // ASK path (AUTO: UNKNOWN/MODIFY/DANGEROUS; FULL_ACCESS: UNKNOWN/DANGEROUS):
  // verify + approve after the session reached the requested asset.
  return {
    risk: classification.risk,
    classification,
    approvalRequired: true,
    beforeExec: async () => {
      verifyTarget(services)
      await askApproval(services, exec, command, classification)
    },
  }
}
