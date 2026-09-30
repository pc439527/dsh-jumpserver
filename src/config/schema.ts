import z from '@deepseek-ai/schemastery'
import {
  DEFAULT_ASSET_CACHE_TTL_SECONDS,
  DEFAULT_BATCH_CONCURRENCY,
  DEFAULT_MAX_SESSIONS,
  DEFAULT_PASSWORD_ENV,
  DEFAULT_TERMINAL_SCROLLBACK,
  MAX_BATCH_CONCURRENCY,
  MAX_SESSIONS_CEILING,
  type JumpServerConfig,
} from './types.js'

/**
 * The settings-card schema is the UI contract: every field here renders on the
 * DSH Plugins page.
 *
 * EVERY field is marked `.volatile()`. That is not cosmetic: the Host's
 * `SettingsForms.volatileForm()` returns undefined unless at least one field
 * declares `meta.volatile`, and `describe()` then SKIPS this entry entirely —
 * so without it the namespace is never served, `configForms.whileServed()`
 * never fires, and the settings card silently never mounts. A plugin that
 * drops this marker looks healthy and renders nothing.
 *
 * volatile also means "applies live": every value below is read per call
 * through `getConfig()`, so an edit takes effect without a Host restart.
 *
 * Fields the model/UI must not hand-edit stay loosely typed on purpose (see
 * assetGroups below): schemastery's dict/nested schema drags cosmokit's Dict
 * into the emitted declaration (TS2742) and the settings card treats the
 * value as plain JSON anyway. Runtime access is defensively parsed in
 * src/config/types.ts + the owning module.
 */
export const Config = z.object({
  enabled: z.boolean().default(true).volatile().description('启用 JumpServer（关闭后所有 jumpserver_* 工具返回 DISABLED）'),
  autoOpenTerminal: z.boolean().default(true).volatile().description('授权（/jumpserver）后自动在右栏打开控制台；未授权不自动打开'),
  terminalScrollback: z.number().min(100).max(50000).default(DEFAULT_TERMINAL_SCROLLBACK).volatile().description('终端保留行数（scrollback，默认 ' + DEFAULT_TERMINAL_SCROLLBACK + '）'),
  host: z.string().default('').volatile().description('JumpServer 服务器地址（传输网关，如 203.0.113.10）；留空时工具返回 NOT_CONFIGURED'),
  port: z
    .number()
    .min(1)
    .max(65535)
    .default(2222)
    .volatile()
    .description('JumpServer SSH 端口'),
  username: z.string().default('').volatile().description('JumpServer 登录用户名；留空时工具返回 NOT_CONFIGURED'),
  password: z
    .string()
    .role('secret')
    .volatile()
    .description('JumpServer 密码（只写到凭据存储；留空则用 passwordEnv 指向的环境变量）'),
  passwordEnv: z
    .string()
    .role('credential-ref')
    .default(DEFAULT_PASSWORD_ENV)
    .volatile()
    .description('保存密码的环境变量名（credential-ref；连接时解析，绝不进入模型上下文）'),
  profiles: z
    .any()
    .default([])
    .volatile()
    .description('多账号：{ id, label, host, port, username, passwordEnv } 列表；activeProfileId 选中者优先于上面的 host/username/passwordEnv，密码仍是 credential-ref'),
  activeProfileId: z.string().volatile().description('当前选中的账号 profile id；留空表示使用设置页的 host/username'),
  hostFingerprint: z.string().volatile().description('SSH 主机密钥指纹（如 SHA256:AbCdEf…）；设置后只接受完全一致的密钥，不设置则首次信任并记录（TOFU）'),
  knownHostsPath: z.string().volatile().description('TOFU 主机密钥存储路径；留空用插件数据目录下的 known_hosts.json'),
  connectTimeout: z.number().min(1).default(15).volatile().description('连接超时（秒）'),
  commandTimeout: z.number().min(1).default(60).volatile().description('命令默认超时（秒）'),
  idleTimeout: z.number().min(1).default(30).volatile().description('空闲连接超时（分钟）'),
  permissionMode: z
    .union([
      z.const('READ_ONLY'),
      z.const('AUTO'),
      z.const('FULL_ACCESS'),
    ])
    .default('READ_ONLY')
    .volatile()
    .description('Agent 自动执行权限：READ_ONLY 只读 / AUTO 修改需审批 / FULL_ACCESS 普通修改直接执行且高危仍审批')
    .role('select'),
  privilegedReadInReadOnly: z
    .boolean()
    .default(false)
    .volatile()
    .description('READ_ONLY 模式是否放行 PRIVILEGED_READ（sudo + 只读命令）；默认不放行'),
  manualPermissionMode: z
    .union([
      z.const('FOLLOW_AGENT'),
      z.const('CONFIRM_MODIFY'),
      z.const('FULL_ACCESS'),
    ])
    .default('CONFIRM_MODIFY')
    .volatile()
    .description('人工终端输入策略：FOLLOW_AGENT 跟随 Agent 权限矩阵 / CONFIRM_MODIFY 只读放行、修改命令需二次确认（推荐，默认）/ FULL_ACCESS 不设限（仍审计）')
    .role('select'),
  timeZone: z.string().default('Asia/Shanghai').volatile().description('审计时间显示时区（IANA 名称；存储始终为 UTC）'),
  allowedTargets: z
    .array(z.string())
    .default([])
    .volatile()
    .description('目标白名单：精确（192.168.79.10）/ 前缀（结尾 . - :）/ glob（oa-*）/ CIDR（192.168.79.0/24）；留空不限制'),
  deniedTargets: z
    .array(z.string())
    .default([])
    .volatile()
    .description('目标黑名单（先于白名单判断，永远优先拒绝）；语法同白名单'),
  batchConcurrency: z
    .number()
    .min(1)
    .max(MAX_BATCH_CONCURRENCY)
    .default(DEFAULT_BATCH_CONCURRENCY)
    .volatile()
    .description('单个批量/巡检调用内并行处理的目标数（1..' + MAX_BATCH_CONCURRENCY + '，1 = 严格串行）；一个对话仍只有一条 PTY'),
  maxSessions: z
    .number()
    .min(1)
    .max(MAX_SESSIONS_CEILING)
    .default(DEFAULT_MAX_SESSIONS)
    .volatile()
    .description('同时进入的目标数上限（1..' + MAX_SESSIONS_CEILING + '，进程级 Semaphore，仅在 batchConcurrency > 1 时生效）'),
  consoleEnabled: z.boolean().default(true).volatile().description('内置运维控制台（仅绑定 127.0.0.1）：终端镜像 / 资产 / 任务 / 审计，稳定 URL 由 jumpserver_status 返回，认证 Token 不进入 URL/日志/工具结果'),
  consolePort: z.number().min(0).max(65535).default(8765).volatile().description('控制台端口；默认 8765，提供稳定的 Desktop 右栏地址'),
  autoReconnect: z.boolean().default(true).volatile().description('空闲断线自动重连（最多 2 次）'),
  assetCacheTtlSeconds: z
    .number()
    .min(10)
    .max(3600)
    .default(DEFAULT_ASSET_CACHE_TTL_SECONDS)
    .volatile()
    .description('资产列表缓存时长（秒）：一次 p 抓取在会话内本地复用（默认 ' + DEFAULT_ASSET_CACHE_TTL_SECONDS + '）'),
  assetGroups: z
    .any()
    .default({})
    .volatile()
    .description('系统资产组（别名）：组名 -> 关键词列表；jumpserver_assets(group="OA") 按关键词 OR 匹配'),
  runbooks: z
    .any()
    .default({})
    .volatile()
    .description('命名 runbook：名称 -> { title, steps[] }；jumpserver_profile_run 按名称执行'),
  riskJudge: z
    .any()
    .default({})
    .volatile()
    .description('可选语义风险裁决：仅对 UNKNOWN 命令征询第二意见，默认关闭；API Key 只经 credential-ref 解析，不写入配置'),
  enableAudit: z.boolean().default(true).volatile().description('记录 Agent 与人工命令执行审计（不含任何密码）'),
})

export type Config = JumpServerConfig
