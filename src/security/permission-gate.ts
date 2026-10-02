/**
 * Permission gate — DSH-native approval, layered with command risk
 * classification, target scoping and refusal auditing.
 *
 * DSH keeps its own boundaries that the MCP port does not have:
 *  - `ctx.get('approval')` is the human approval service (no confirm:true
 *    retry handshake), and a rejected/cancelled/unavailable approval aborts the
 *    command;
 *  - the conversation-scoped Session Grant is checked by the callers, before
 *    this module runs.
 *
 * Ported on top of that, unchanged in behaviour:
 *  - V0.5.7 advisory semantic second opinion for UNKNOWN commands;
 *  - V0.5.8 opt-in, fail-closed auto-allow (the ONE path a verdict may change
 *    an outcome);
 *  - V0.5.9 every refusal is audited exactly once: BLOCKED when the rules said
 *    no, DENIED when no human approval was granted.
 */
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import type { CommandRisk, PermissionMode, RiskJudgeAutoAllowConfig, RiskJudgeConfig } from '../config/types.js'
import { APPROVAL_DENIED_REASON, JumpServerError } from '../jumpserver/errors.js'
import type { SessionManager } from '../jumpserver/session-manager.js'
import { redactCommandSecrets } from './command-redaction.js'
import { classifyCommand, gateDecision, requireTargetVerified, type Classification } from './permission.js'
import { decideAutoAllow, judgeCommandRiskDetailed, riskJudgeAuditLine, riskJudgeNote, riskJudgeSummary, type RiskJudgeError, type RiskJudgeVerdict } from './risk-judge.js'

export interface GateServices {
  getConfig: () => {
    permissionMode: PermissionMode
    privilegedReadInReadOnly?: boolean
    riskJudge?: RiskJudgeConfig
  }
  manager: SessionManager
  approval?: ApprovalService
  /**
   * Resolve a secret by its credential reference. The settings card writes the
   * JumpServer password AND the Jev API key into the DSH credential domain, so
   * the judge must read through the same seam rather than process.env.
   */
  resolveCredential?: (ref: string) => Promise<string | undefined>
}

export interface GatedCommand {
  risk: CommandRisk
  /** Full classification (ruleId/reason/confidence) — audit + approval copy. */
  classification: Classification
  /** True when this gated command required a human approval (for the audit). */
  approvalRequired: boolean
  /** Runs right after navigation (run/batch): verify target, then ask. */
  beforeExec?: () => Promise<void>
  /** V0.5.8: the judge's opinion, when the classifier could not rule. */
  judge?: RiskJudgeVerdict
  /** V0.5.8: true when that opinion let this command skip the human prompt. */
  judgeAutoAllowed?: boolean
  /** V0.5.8: one-line record of the judge decision (audit + tool result). */
  judgeNote?: string
}

/** Approval text never exposes command-line secrets. */
function approvalReason(
  status: { target: string | null; hostname: string | null },
  command: string,
  classification: Classification,
  judgeLines: string[] = [],
): string {
  const target = '目标服务器：' + (status.target ?? '?') + ' / ' + (status.hostname ?? 'unknown host')
  const safeCommand = redactCommandSecrets(command)
  const lines: string[] = [target, '准备执行：' + safeCommand, '']
  switch (classification.risk) {
    case 'UNKNOWN':
      lines.push('风险：无法确认该命令是否为只读（规则 ' + classification.ruleId + '）')
      lines.push('原因：当前分类器没有足够语义规则，不能确认它是否修改服务器。')
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
  if (judgeLines.length > 0) {
    lines.push('')
    for (const line of judgeLines) lines.push(line)
  }
  return lines.join('\n')
}

function batchApprovalReason(
  status: { target: string | null; hostname: string | null },
  items: Array<{ command: string; classification: Classification; judgeLines?: string[] }>,
): string {
  const lines = [
    '目标服务器：' + (status.target ?? '?') + ' / ' + (status.hostname ?? 'unknown host'),
    '本批次有 ' + items.length + ' 条命令需要人工审批：',
    '',
  ]
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    lines.push(String(i + 1) + '. [' + item.classification.risk + '] ' + redactCommandSecrets(item.command))
    lines.push('   规则：' + item.classification.ruleId + ' · ' + item.classification.reason)
    for (const judgeLine of item.judgeLines ?? []) lines.push('   ' + judgeLine)
  }
  lines.push('', '允许后仅执行上面列出的本批次命令；是否允许？')
  return lines.join('\n')
}

async function requestApproval(services: GateServices, exec: ToolRunContext, reason: string): Promise<void> {
  const approval = services.approval
  if (approval === undefined) {
    throw new JumpServerError('COMMAND_APPROVAL_REQUIRED', 'approval service unavailable; the command was not executed')
  }
  if (exec.agent === undefined) {
    throw new JumpServerError('COMMAND_APPROVAL_REQUIRED', 'no agent to route approval through; the command was not executed')
  }
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

/**
 * V0.5.7 advisory second opinion for one UNKNOWN command.
 *
 * Called ONLY right before an approval prompt is built: a command that is
 * blocked outright needs no reading, and READ / PRIVILEGED_READ / MODIFY /
 * DANGEROUS are never sent anywhere.
 *
 * Failures still yield no verdict and never change the gate's decision, but the
 * reason is now REPORTED. Returning a bare null made "the key you saved is not
 * being read" indistinguishable from "the judge is switched off".
 */
async function judgeUnknown(
  services: GateServices,
  classification: Classification,
): Promise<{ verdict: RiskJudgeVerdict | null; error?: RiskJudgeError }> {
  if (classification.risk !== 'UNKNOWN') return { verdict: null }
  try {
    return await judgeCommandRiskDetailed(
      classification.command,
      services.getConfig().riskJudge,
      services.resolveCredential,
    )
  } catch (error) {
    return { verdict: null, error: 'unreachable' }
  }
}

function autoAllowConfig(services: GateServices): RiskJudgeAutoAllowConfig | undefined {
  return services.getConfig().riskJudge?.autoAllow
}

/**
 * V0.5.8: apply the (opt-in, fail-closed) auto-allow guard to one pending
 * UNKNOWN command. The target is verified BEFORE this runs, so an auto-allowed
 * command is never executed against an unverified asset.
 */
function applyJudge(
  services: GateServices,
  classification: Classification,
  verdict: RiskJudgeVerdict | null,
): { auto: boolean; reason: string; note?: string } {
  const decision = decideAutoAllow(verdict, { command: classification.command, ruleId: classification.ruleId }, autoAllowConfig(services))
  if (decision.allow) {
    return {
      auto: true,
      reason: decision.reason,
      note: verdict === null ? undefined : riskJudgeAuditLine(verdict, true, decision.reason),
    }
  }
  if (verdict === null) return { auto: false, reason: decision.reason }
  return { auto: false, reason: decision.reason, note: riskJudgeAuditLine(verdict, false, decision.reason) }
}

/**
 * V0.5.8: one line reporting the commands that ran WITHOUT a human prompt
 * because the judge allowed them. Undefined when nothing was auto-allowed, so
 * an unremarkable call renders exactly as before.
 */
export function judgeAutoAllowNote(gated: GatedCommand[]): string | undefined {
  const allowed = gated.filter((item) => item.judgeAutoAllowed === true && item.judgeNote !== undefined)
  if (allowed.length === 0) return undefined
  return allowed.length + ' 条命令经语义判定自动放行（未询问人工）: ' + allowed.map((item) => item.judgeNote).join(' | ')
}

async function askApproval(
  services: GateServices,
  exec: ToolRunContext,
  command: string,
  classification: Classification,
  verdict: RiskJudgeVerdict | null = null,
  noteOptions: { autoAllowEnabled?: boolean; autoAllowRefusal?: string } = {},
): Promise<void> {
  const status = services.manager.status()
  await requestApproval(services, exec, approvalReason(status, command, classification, riskJudgeNote(verdict, noteOptions)))
}

/**
 * V0.5.9: leave a trace before a refusal turns into an exception.
 *
 * Best-effort on purpose: the audit sink must never be able to change what the
 * gate does, so a write failure is swallowed and the refusal proceeds.
 */
async function recordRefusal(
  services: GateServices,
  exec: ToolRunContext,
  input: {
    operation: string
    command: string
    classification: Classification
    reason: string
    kind: 'blocked' | 'denied'
    riskJudge?: string
    batchId?: string
    batchIndex?: number
  },
): Promise<string | undefined> {
  try {
    await services.manager.recordDenied({
      operation: input.operation,
      command: input.command,
      risk: input.classification.risk,
      classification: input.classification,
      reason: input.reason,
      kind: input.kind,
      riskJudge: input.riskJudge,
      toolCallId: String(exec.callId),
      batchId: input.batchId,
      batchIndex: input.batchIndex,
    })
    return undefined
  } catch (error) {
    // An audit failure must never change the gate's decision, but it MUST be
    // visible: "a refusal always leaves a trace" is a safety promise, and a
    // silently swallowed write makes a broken promise indistinguishable from a
    // refusal that was simply never recorded. The caller attaches this to the
    // thrown error so it reaches the tool result and the console.
    return error instanceof Error ? (error.stack ?? error.message) : String(error)
  }
}

/** Re-throw the gate's decision, carrying an audit-write failure when there was one. */
function rethrowWithAuditFailure(error: unknown, auditFailure: string | undefined): never {
  if (auditFailure === undefined) throw error
  const code = error instanceof JumpServerError ? error.code : 'COMMAND_BLOCKED'
  const message = error instanceof Error ? error.message : String(error)
  const prior = error instanceof JumpServerError ? error.detail : undefined
  const detail = (prior !== undefined && prior.length > 0 ? prior + ' | ' : '') + 'AUDIT_WRITE_FAILED: ' + auditFailure
  throw new JumpServerError(code, message, detail)
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
    const { verdict } = await judgeUnknown(services, classification)
    const judge = applyJudge(services, classification, verdict)
    if (judge.auto) {
      return {
        risk: classification.risk,
        classification,
        approvalRequired: false,
        judge: verdict ?? undefined,
        judgeAutoAllowed: true,
        judgeNote: judge.note,
      }
    }
    try {
      await askApproval(services, exec, command, classification, verdict, {
        autoAllowEnabled: autoAllowConfig(services)?.enabled === true,
        autoAllowRefusal: judge.reason,
      })
    } catch (error) {
      // V0.5.9: exec's approval runs inline (exec has no beforeExec), so this is
      // the only place a DENIED record can come from on the exec path.
      const auditFailure = await recordRefusal(services, exec, {
        operation: 'exec',
        command,
        classification,
        reason: APPROVAL_DENIED_REASON,
        kind: 'denied',
        riskJudge: judge.note,
      })
      rethrowWithAuditFailure(error, auditFailure)
    }
    return {
      risk: classification.risk,
      classification,
      approvalRequired: true,
      judge: verdict ?? undefined,
      judgeNote: judge.note,
    }
  }
  // V0.5.9: a rule refusal is recorded, not only thrown.
  const auditFailure = await recordRefusal(services, exec, {
    operation: 'exec',
    command,
    classification,
    reason: decision.reason,
    kind: 'blocked',
  })
  rethrowWithAuditFailure(
    new JumpServerError('COMMAND_BLOCKED', command + ' -- ' + decision.reason),
    auditFailure,
  )
}

/**
 * Gate for jumpserver_run: navigation happens inside manager.run, so target
 * verification + approval are deferred until the requested asset is entered.
 */
export async function gateCommandForNavigation(services: GateServices, exec: ToolRunContext, command: string): Promise<GatedCommand> {
  const cfg = services.getConfig()
  const classification = classifyCommand(command)
  const decision = gateDecision(classification.risk, cfg.permissionMode, { privilegedReadInReadOnly: cfg.privilegedReadInReadOnly })
  if (decision.kind === 'allow') return { risk: classification.risk, classification, approvalRequired: false }
  if (decision.code === 'COMMAND_BLOCKED') {
    await recordRefusal(services, exec, {
      operation: 'run',
      command,
      classification,
      reason: decision.reason,
      kind: 'blocked',
    })
    throw new JumpServerError('COMMAND_BLOCKED', command + ' -- ' + decision.reason)
  }
  const { verdict } = await judgeUnknown(services, classification)
  const judge = applyJudge(services, classification, verdict)
  const autoAllowEnabled = autoAllowConfig(services)?.enabled === true
  if (judge.auto) {
    return {
      risk: classification.risk,
      classification,
      approvalRequired: false,
      judge: verdict ?? undefined,
      judgeAutoAllowed: true,
      judgeNote: judge.note,
      // Verification is NOT skipped for an auto-allowed command: it is the
      // reason the approval existed, and it is cheap.
      beforeExec: async () => {
        verifyTarget(services)
      },
    }
  }
  return {
    risk: classification.risk,
    classification,
    approvalRequired: true,
    judge: verdict ?? undefined,
    judgeNote: judge.note,
    beforeExec: async () => {
      verifyTarget(services)
      // The approval runs HERE (deferred until the asset is entered), so this is
      // the only place a DENIED record can come from on the run path. Without
      // it a rejected jumpserver_run left no audit trace at all.
      try {
        await askApproval(services, exec, command, classification, verdict, {
          autoAllowEnabled,
          autoAllowRefusal: judge.reason,
        })
      } catch (error) {
        const auditFailure = await recordRefusal(services, exec, {
          operation: 'run',
          command,
          classification,
          reason: APPROVAL_DENIED_REASON,
          kind: 'denied',
          riskJudge: judge.note,
        })
        rethrowWithAuditFailure(error, auditFailure)
      }
    },
  }
}

/**
 * Batch gate for one target. Confirmed READs are never included in an
 * approval. When 2-10 approval-required commands are short enough to display
 * completely, they share ONE target-verified approval prompt; otherwise each
 * command falls back to its own prompt. DANGEROUS items remain visible in that
 * explicit batch approval and are never silently allowed.
 */
export async function gateCommandsForNavigation(
  services: GateServices,
  exec: ToolRunContext,
  commands: string[],
): Promise<GatedCommand[]> {
  const cfg = services.getConfig()
  // V0.5.9: a plain for-loop, not map() — a refusal has to reach the audit
  // BEFORE it is thrown, and that needs an await inside the iteration.
  const gated: Array<{ command: string; gated: GatedCommand }> = []
  for (const command of commands) {
    const classification = classifyCommand(command)
    const decision = gateDecision(classification.risk, cfg.permissionMode, { privilegedReadInReadOnly: cfg.privilegedReadInReadOnly })
    if (decision.kind === 'allow') {
      gated.push({ command, gated: { risk: classification.risk, classification, approvalRequired: false } })
      continue
    }
    if (decision.code === 'COMMAND_BLOCKED') {
      await recordRefusal(services, exec, {
        operation: 'run-batch',
        command,
        classification,
        reason: decision.reason,
        kind: 'blocked',
      })
      throw new JumpServerError('COMMAND_BLOCKED', command + ' -- ' + decision.reason)
    }
    gated.push({ command, gated: { risk: classification.risk, classification, approvalRequired: true } })
  }

  const approvalItems = gated.filter((item) => item.gated.approvalRequired)
  if (approvalItems.length === 0) return gated.map((item) => item.gated)

  // V0.5.7: advisory verdicts for the UNKNOWN items of this batch, fetched in
  // parallel (cached per command). Rendered into the prompt only.
  // V0.5.8: the same verdicts feed the auto-allow guard.
  const verdicts = new Map<object, RiskJudgeVerdict | null>()
  await Promise.all(
    approvalItems.map(async (item) => {
      verdicts.set(item, (await judgeUnknown(services, item.gated.classification)).verdict)
    }),
  )

  const autoAllowEnabled = autoAllowConfig(services)?.enabled === true
  const refusals = new Map<object, string>()
  const stillPending: typeof approvalItems = []
  for (const item of approvalItems) {
    const verdict = verdicts.get(item) ?? null
    const judge = applyJudge(services, item.gated.classification, verdict)
    item.gated.judge = verdict ?? undefined
    item.gated.judgeNote = judge.note
    if (judge.auto) {
      item.gated.approvalRequired = false
      item.gated.judgeAutoAllowed = true
      item.gated.beforeExec = async () => {
        verifyTarget(services)
      }
      continue
    }
    refusals.set(item, judge.reason)
    stillPending.push(item)
  }
  if (stillPending.length === 0) return gated.map((item) => item.gated)

  const judgeLinesFor = (item: { command: string }): string[] | undefined => {
    const verdict = verdicts.get(item) ?? null
    if (verdict === null) return undefined
    if (!autoAllowEnabled) return ['语义副驾：' + riskJudgeSummary(verdict) + '（仅供参考，不参与放行判定）']
    const refusal = refusals.get(item) ?? ''
    return ['语义副驾：' + riskJudgeSummary(verdict) + ' · 自动放行未通过：' + refusal]
  }

  const canGroup = stillPending.length >= 2 && stillPending.length <= 10 && stillPending.every((item) => redactCommandSecrets(item.command).length <= 500)
  if (!canGroup) {
    for (const item of stillPending) {
      item.gated.beforeExec = async () => {
        verifyTarget(services)
        // Deferred approval: this is the only place a DENIED batch item can be
        // recorded, exactly as on the single-command run path.
        try {
          await askApproval(services, exec, item.command, item.gated.classification, verdicts.get(item) ?? null, {
            autoAllowEnabled,
            autoAllowRefusal: refusals.get(item) ?? '',
          })
        } catch (error) {
          const auditFailure = await recordRefusal(services, exec, {
            operation: 'batch',
            command: item.command,
            classification: item.gated.classification,
            reason: APPROVAL_DENIED_REASON,
            kind: 'denied',
            riskJudge: item.gated.judgeNote,
            batchIndex: stillPending.indexOf(item),
          })
          rethrowWithAuditFailure(error, auditFailure)
        }
      }
    }
    return gated.map((item) => item.gated)
  }

  let state: 'pending' | 'approved' | 'failed' = 'pending'
  let failure: unknown
  const approveGroup = async (): Promise<void> => {
    if (state === 'approved') return
    if (state === 'failed') throw failure
    verifyTarget(services)
    try {
      const status = services.manager.status()
      await requestApproval(
        services,
        exec,
        batchApprovalReason(
          status,
          stillPending.map((item) => ({
            command: item.command,
            classification: item.gated.classification,
            judgeLines: judgeLinesFor(item),
          })),
        ),
      )
      state = 'approved'
    } catch (error) {
      state = 'failed'
      failure = error
      // A grouped approval covers every pending item, so record each command
      // that was refused rather than only the first one.
      for (const item of stillPending) {
        const auditFailure = await recordRefusal(services, exec, {
          operation: 'batch',
          command: item.command,
          classification: item.gated.classification,
          reason: APPROVAL_DENIED_REASON,
          kind: 'denied',
          riskJudge: item.gated.judgeNote,
          batchIndex: stillPending.indexOf(item),
        })
        if (auditFailure !== undefined) {
          rethrowWithAuditFailure(error, auditFailure)
        }
      }
      throw error
    }
  }
  for (const item of stillPending) item.gated.beforeExec = approveGroup
  return gated.map((item) => item.gated)
}
