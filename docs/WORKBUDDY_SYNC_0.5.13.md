# WorkBuddy → dsh-jumpserver 同步追踪（jumpserver-mcp v0.5.13）

> 基线：`dsh-jumpserver` v0.3.1（branch `main` @ `c4443add5`）
> 参考：`D:/desktop/<department>/WorkBuddy/jumpserver-mcp` v0.5.13（branch `main` @ `03d3ffd`，只读）
> 分支：`sync/workbuddy-0.5.13`

血缘：`jumpserver-mcp` 由 `dsh-jumpserver` v0.3.1 的 `src/jumpserver/` + `src/security/` 原样移植而来，
此后 DSH 侧停在 0.3.x，WB 侧演进到 0.5.13（v0.4.0 巡检平台 / v0.4.1 fleet / v0.4.3 正确性 /
v0.4.5 job 生命周期 / v0.5.0 宿主密钥与配置分层 / v0.5.2 可诊断性与注解 / v0.5.3+5.6 多账号选择 /
v0.5.5 不可达快速失败 / v0.5.7+5.8 语义风险裁决 / v0.5.9 拒绝审计 / v0.5.10–5.13 控制台与多账号）。

## 1. 逐文件映射与状态

图例：✅ 已同步（本分支已验证） / 🔜 已移植待接线 / ⏳ 未开始 / ⛔ 有意不做（WorkBuddy 专有）

### jumpserver/（核心传输）
| WB 模块 | DSH 落点 | 状态 |
|---|---|---|
| `errors.ts` `state-machine.ts` `detector.ts` `client.ts` | 同名 | ✅ |
| `command-status.ts` `host-key.ts` `concurrency.ts` | 新增同名 | ✅ |
| `session.ts` `session-manager.ts` | 同名 | ✅ |
| `host-parse.ts` `profiles.ts` `topology.ts` `inspector.ts` `runbook.ts` | 新增同名 | ✅ 已接成 inspect / topology / profile_run / baseline_* 工具 |
| `compare.ts` | 新增同名 | 🔜 已移植，待替换 DSH 现有 `jumpserver_compare`（ops 统一） |
| `asset-list.ts` `command-runner.ts` `mutex.ts` `output-buffer.ts` `probe.ts` `session-registry.ts` `terminal-observer.ts` `timing.ts` | 同名 | ✅（本就一致，无需改动） |

### security/
| WB 模块 | DSH 落点 | 状态 |
|---|---|---|
| `audit.ts` `command-classifier.ts` `sql-command-classifier.ts` `permission.ts` | 同名 | ✅ |
| `target-scope.ts` | 新增 | ✅ 已在 enter/run/batch/exec/人工进入 前强制执行 |
| `risk-judge.ts` | 新增 | ✅ 已接入 permission-gate（advisory + autoAllow + 审计行） |
| `permission-gate.ts` | 同名 | ✅ target scope + risk judge + BLOCKED/DENIED 拒绝审计 |
| `command-redaction.ts` `grant.ts` | 同名 | ✅ |

### runtime/（DSH 侧新建，WB 的 runtime/* 是 MCP/控制台专有）
| WB 模块 | DSH 落点 | 状态 |
|---|---|---|
| `job-store.ts` `interrupt.ts` `time.ts` `baseline-store.ts` | `src/runtime/` 同名 | ✅ job 与 baseline 均已接线并测试 |
| `asset-store.ts` `topology-store.ts` | `src/runtime/` 同名 | 🔜 供侧栏用，待接线 |
| `paths.ts`（DSH 新建） | `src/runtime/paths.ts` | ✅ 插件状态落在 `<dsh home>/jumpserver/` |
| `audit-store.ts`（JSONL） | — | ⛔ DSH 用 `storageDomain`（见 §3） |
| `audit-viewer.ts`（HTTP 控制台） | — | ⛔ DSH 由 better-sidebar 承担 |
| `doctor.ts` `config-guard.ts` `profile-store.ts` `credential-vault.ts` `console-*` `session-scope.ts` `tool-host.ts` `runtime.ts` `tools-common.ts` `tools-ops.ts` `progress.ts` | — | ⛔ MCP/WorkBuddy 专有（等价能力见 §3） |
| `config/env.ts` | — | ⛔ 连接器表单 ENV 分层；DSH 用设置页 + credential-ref + `profiles` |

### 配置
| 变更 | 状态 |
|---|---|
| `timeZone` `allowedTargets` `deniedTargets` `batchConcurrency` `maxSessions` `hostFingerprint` `knownHostsPath` `runbooks` `riskJudge` | ✅ 已进 schema/types（设置卡片自动渲染） |
| `profiles` + `activeProfileId`（多账号的 DSH 形态） | ✅ 已实现 `resolveConnection()`，密码仍走 credential-ref |
| DSH 保留项 `enabled` `autoOpenTerminal` `manualPermissionMode` | ✅ |

### 工具面
| 工具 | 状态 |
|---|---|
| `jumpserver_status`（+ connection provenance / missing） | ✅ |
| `jumpserver_enter/run/batch`（+ `accountIndex` / `accountByTarget`） | ✅ 已接 |
| `jumpserver_exec`（+ target scope 复核） | ✅ |
| `jumpserver_interrupt` `jumpserver_job_start` `jumpserver_job_read` `jumpserver_job_stop` `jumpserver_jobs` `jumpserver_snapshot` | ✅ 新增并测试 |
| `jumpserver_inspect` `jumpserver_topology` `jumpserver_profile_run` `jumpserver_baseline_capture` `jumpserver_baseline_compare` | ✅ 已注册并测试（含 `accountByTarget`） |
| `jumpserver_audit`（对话内读审计 + 拒绝原因） | ✅ 已注册并测试 |
| `jumpserver_triage/compare/case/remediate`（DSH 独有 ops） | ⏳ 待按"以 WB inspector 为事实源"统一 |
| `jumpserver_console_rotate_token` `jumpserver_arm/disarm` | ⛔ DSH 无控制台令牌；DSH 的 `/jumpserver` 会话授权更强 |

### 侧栏 / 桥接
| 能力 | 状态 |
|---|---|
| 侧栏 任务 标签（列表 / 停止 / 中断） | ✅ |
| 侧栏 审计 标签渲染「已拦截 / 未批准」+ 拒绝筛选 | ✅ |
| `/api/jumpserver.jobs` / `.jobStop` / `.interrupt` | ✅ 均 POST-only + same-site + 按对话授权 |
| `PROTOCOL_VERSION` | ✅ 3 → 4 |

## 2. 已完成并验证（本分支）

七个功能提交，每个都通过 `npm run typecheck`（host+client）与 `npx vitest run`（当前 399/399）：

1. `2ce3924e4` 核心移植：传输层（账号选择 / 不可达冷却 / commandStatus / job PTY 归属 /
   sessionGate / 拒绝审计）、安全层（10 个新错误码、classifier 扩充、hdbsql+SAP、
   risk-judge、target-scope）、配置合并、渲染器（detail / STOP 行 / riskJudge /
   批量失败计数 / 命令脱敏）。
2. `d19aeeb11` 接线：target scope 前置拒绝、accountIndex、maxSessions Semaphore、
   known_hosts 落到 `~/.dsh/jumpserver/known_hosts.json`、连接来源（profile/settings）
   与缺失项诊断、多账号 `profiles`。
3. `91d832683` 流式任务：`jumpserver_job_*` / `interrupt` / `snapshot` 六个工具 +
   `tests/jobs.test.ts`（游标读、单次 Ctrl+C、幂等 stop、按对话隔离、关闭后 LOST）。

4. `75ac07f0d` 采集工具面：`inspect` / `topology` / `profile_run` / `baseline_capture` / `baseline_compare`
   五个工具 + `accountByTarget` + baseline 落盘到 DSH home；顺带把 WB 源码里两个字符串字面量中的原始
   NUL 字节换成 `\u0000` 转义（运行值不变，文件恢复为纯文本）。
5. `62dba538d` 风险裁决与拒绝审计：advisory judge（仅 UNKNOWN 外发）、opt-in autoAllow、
   BLOCKED/DENIED 各恰好一条审计、`riskJudge` 贯通 exec/run/batch/job_start 结果。
6. `jumpserver_audit`：对话内审计（本地时间、`why=` 拒绝原因、`refusalsOnly`、limit/filter）。
7. 侧栏 任务 标签 + 桥接 `/api/jumpserver.jobs|jobStop|interrupt` + 审计标签「已拦截/未批准」
   与拒绝筛选；`PROTOCOL_VERSION` 3 → 4。

顺带修掉两个**基线就存在的**陈旧测试：`tests/bridge-security.test.ts` 的快照长轮询
（`sinceSeq: 1` vs 轮询桩 `cursorSeq: 1`，永远挂到 12 s）与三处已被 v0.5.5 语义取代的期望
（`ENTERING_ASSET → JUMPSERVER_MENU` 现在合法；`连接失败` 现在归 `ASSET_UNREACHABLE`）。

## 3. 关键设计决定（已确认）

- **审计**：沿用 DSH `storageDomain`（zod schema 已扩 `riskJudge` / `refusalReason` /
  `toolCallId` / `batchId` / `taskId` / `batchIndex` / `sequence`，全部 optional，旧记录可读）；
  不引入 WB 的 JSONL + 归档。
- **凭据**：沿用 DSH credential-ref；不引入 `~/.workbuddy` 的 AES `profiles.json`。
- **审批**：沿用 DSH `ctx.get('approval')`（含 batch 一次审批）；不采用 WB 的 `confirm:true` 二次调用。
- **控制台**：不移植 HTTP 控制台 / 实例选择器 / console token；侧栏视图按需扩展。
- **progress / annotations**：DSH 工具面无对应能力，不做（无回归）。

## 4. 剩余工作（按优先级）

1. **ops 统一（Phase 3b）** — `jumpserver_triage` 改用 `inspector` 的固定只读探针 + `host-parse` 的
   `HostInventory`（证据仍进 `EvidenceLedger`）；`jumpserver_compare` 换成 `compareTargets`
   （分组 + 多重集 outlier，失败主机保留自身错误码）；`jumpserver_remediate` 预检复用 `inspector`；
   删除 `src/ops/{profiles,collect}.ts` 的重复度量逻辑，保留 case/证据账本。
2. **测试移植（Phase 7）** — 把 WB 的 `node:test .mjs` 用例转成 vitest：`host-parse` / `runbook` /
   `topology` / `concurrency` / `enter-unreachable` / `session-account-selection` / `host-key` /
   `target-scope` / `job-start-gate`；新增 context-budget 测试（注册工具 schema < 40 KB）。
3. **文档与版本** — README 工具表/权限矩阵重写（现为 24 个工具 + 侧栏 4 个标签）；`package.json`
   → 0.4.0；`PLUGIN_VERSION` 同步；`tests/version-consistency` 覆盖 README 工具表。

## 5. 验证入口

```bash
npm run typecheck          # host + client
npx vitest run             # 399/399（新增 jobs / jobs-bridge / inspection-tools / risk-judge-gate / jumpserver-audit）
node scripts/classifier-report.mjs
npm run build && npm run smoke:client && node scripts/sync-profile.mjs
```
