import z from '@deepseek-ai/schemastery'
import { DEFAULT_ASSET_CACHE_TTL_SECONDS, DEFAULT_PASSWORD_ENV, DEFAULT_TERMINAL_SCROLLBACK, type JumpServerConfig } from './types.js'

export const Config = z.object({
  enabled: z.boolean().default(true).description('启用 JumpServer（关闭后所有 jumpserver_* 工具返回 DISABLED）'),
  autoOpenTerminal: z.boolean().default(true).description('授权（/jumpserver）后自动打开侧栏的 JumpServer 终端标签页；未授权不自动打开'),
  terminalScrollback: z.number().min(100).max(50000).default(DEFAULT_TERMINAL_SCROLLBACK).description('终端保留行数（scrollback，默认 ' + DEFAULT_TERMINAL_SCROLLBACK + '）'),
  host: z.string().required().description('JumpServer 服务器地址（传输网关，如 203.0.113.10）'),
  port: z
    .number()
    .min(1)
    .max(65535)
    .default(2222)
    .description('JumpServer SSH 端口'),
  username: z.string().required().description('JumpServer 登录用户名'),
  password: z
    .string()
    .role('secret')
    .description('JumpServer 密码（只写到凭据存储；留空则用 passwordEnv 指向的环境变量）'),
  passwordEnv: z
    .string()
    .role('credential-ref')
    .default(DEFAULT_PASSWORD_ENV)
    .description('保存密码的环境变量名（credential-ref；连接时解析，绝不进入模型上下文）'),
  connectTimeout: z.number().min(1).default(15).description('连接超时（秒）'),
  commandTimeout: z.number().min(1).default(60).description('命令默认超时（秒）'),
  idleTimeout: z.number().min(1).default(30).description('空闲连接超时（分钟）'),
  permissionMode: z
    .union([
      z.const('READ_ONLY'),
      z.const('AUTO'),
      z.const('FULL_ACCESS'),
    ])
    .default('READ_ONLY')
    .description('Agent 自动执行权限：READ_ONLY 只读 / AUTO 修改需审批 / FULL_ACCESS 普通修改直接执行且高危仍审批')
    .role('select'),
  manualPermissionMode: z
    .union([
      z.const('FOLLOW_AGENT'),
      z.const('CONFIRM_MODIFY'),
      z.const('FULL_ACCESS'),
    ])
    .default('CONFIRM_MODIFY')
    .description('V0.2.7 人工终端输入策略：FOLLOW_AGENT 跟随 Agent 权限矩阵 / CONFIRM_MODIFY 只读放行、修改命令需二次确认（推荐，默认）/ FULL_ACCESS 人工输入不设限（仍审计）')
    .role('select'),
  autoReconnect: z.boolean().default(true).description('空闲断线自动重连（最多 2 次）'),
  assetCacheTtlSeconds: z
    .number()
    .min(10)
    .max(3600)
    .default(DEFAULT_ASSET_CACHE_TTL_SECONDS)
    .description('资产列表缓存时长（秒）：一次 p 抓取在会话内本地复用，避免每次资产查询都重新向 KoKo 发 p（默认 ' + DEFAULT_ASSET_CACHE_TTL_SECONDS + '）'),
  // V0.2.6: system asset groups (group name -> keywords). Kept loosely typed
  // on purpose: schemastery's dict schema drags cosmokit's Dict into the
  // emitted declaration (TS2742), and the UI/patch flow treats the value as
  // plain JSON anyway. Runtime access is defensively parsed in the manager.
  assetGroups: z
    .any()
    .default({})
    .description('V0.2.6 系统资产组（别名）：组名 -> 关键词列表；jumpserver_assets(group="OA") 按关键词 OR 匹配，例如 { "OA": { "keywords": ["OA","portal","workflow","办公"] } }（可在配置或 cordis.patch.yml 提供）'),
  enableAudit: z.boolean().default(true).description('记录 Agent 与人工命令执行审计（不含任何密码）'),
})

export type Config = JumpServerConfig
