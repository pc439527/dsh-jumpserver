# WorkBuddy → dsh-jumpserver 同步追踪（jumpserver-mcp v0.5.13）

> 基线：`dsh-jumpserver` v0.3.1（branch `main` @ `c4443add5`）
> 参考：`<workbuddy-repo>`（branch `main`）
> - WorkBuddy base commit: `03d3ffd`（公开发布的 0.5.1）
> - Local patch version: 0.5.13（本地继续开发，未 push）
> - 复现说明：`03d3ffd` 是公开可取的基线；0.5.13 是本地增量，仅凭 `0.5.13 @ 03d3ffd` 无法复现
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
| `compare.ts` | 新增同名 | ✅ 已接线：`jumpserver_compare` 已替换为 `compareTargets`（分组 + 多重集 outlier） |
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
| `asset-store.ts` `topology-store.ts` | `src/runtime/` 同名 | 🔜 供侧栏用，**仍未接线**（两类的实例化点全仓不存在） |
| `paths.ts`（DSH 新建） | `src/runtime/paths.ts` | ✅ 插件状态落在 `<dsh home>/jumpserver/` |
| `audit-store.ts`（JSONL） | — | ⛔ DSH 用 `storageDomain`（见 §3） |
| `audit-viewer.ts`（HTTP 控制台） | — | ✅ 由 `runtime/console-page.ts` 的审计标签承担 |
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
| `jumpserver_triage/compare/case/remediate`（DSH 独有 ops） | ⏳ 部分完成：`compare` 已统一；`triage`/`remediate` 仍走 `src/ops/profiles.ts` 自有 profile，未复用 inspector 固定探针 |
| `jumpserver_console_rotate_token` `jumpserver_arm/disarm` | ⛔ DSH 无控制台令牌；DSH 的 `/jumpserver` 会话授权更强 |

### 侧栏 / 桥接
| 能力 | 状态 |
|---|---|
| 控制台 任务 标签（列表 / 停止 / 中断） | ✅ |
| 控制台 审计 标签渲染「已拦截 / 未批准」+ 拒绝筛选 | ✅ |
| `/api/jumpserver.jobs` / `.jobStop` / `.interrupt` | ✅ 均 POST-only + same-site + 按对话授权 |
| `PROTOCOL_VERSION` | ✅ 3 → 4 |

## 2. 已完成并验证（本分支）

七个功能提交，每个都通过 `npm run typecheck`（host+client）与 `npx vitest run`（当时 399/399；当前已增至 **490/490**，60 个测试文件）：

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
7. 控制台 任务 标签 + 桥接 `/api/jumpserver.jobs|jobStop|interrupt` + 审计标签「已拦截/未批准」
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
- **控制台**：已实现 loopback HTTP 控制台（终端/资产/任务/审计）；**未**移植实例选择器；Token 采用 Host 内存 + HttpOnly Cookie，不进入 URL/日志/工具结果。
- **progress / annotations**：DSH 工具面无对应能力，不做（无回归）。

## 4. 剩余工作（按优先级）

1. **ops 统一（Phase 3b）** — 部分完成：`jumpserver_compare` 已换成 `compareTargets`
   （分组 + 多重集 outlier，失败主机保留自身错误码）。
   **仍待做**：`jumpserver_triage` 改用 `inspector` 的固定只读探针 + `host-parse` 的
   `HostInventory`（证据仍进 `EvidenceLedger`）；`jumpserver_remediate` 预检复用 `inspector`；
   删除 `src/ops/{profiles,collect}.ts` 的重复度量逻辑，保留 case/证据账本。
2. **测试移植（Phase 7）** — 大部分已完成：`host-parse` / `runbook` / `topology` /
   `concurrency` / `enter-unreachable` / `session-account-selection` / `host-key` /
   `target-scope` / `job-start-gate` 均有 vitest 覆盖；`tests/context-budget.test.ts` 已建立
   （总预算 **28 KB**、单工具 3 KB）。剩余为把 WB 侧仍缺的用例继续补齐。
3. **文档与版本** — ✅ 已完成：`package.json` → 0.4.0、`PLUGIN_VERSION` 同步（0.4.0）、
   `PROTOCOL_VERSION` 4、README 工具表（25 个工具）/ 权限矩阵已重写并由
   `tests/version-consistency` 覆盖。

## 5. 验证入口

```bash
npm run typecheck          # host + client
npx vitest run             # 490/490，60 个测试文件（jobs / jobs-bridge / inspection-tools / risk-judge-gate / jumpserver-audit 等）
node scripts/classifier-report.mjs
npm run build && npm run smoke:client && node scripts/sync-profile.mjs
```

## 6. 部署方式（与机器无关）

| 项 | 值 |
|---|---|
| 目标 profile | **desktop**（DSH Desktop 0.2.x，Node 22.19+）。`sync-profile` 按 `JS_PROFILE_PKG` → `DSH_PROFILE_DIR` → 自动探测 `~/.dsh/profiles/*` 的顺序解析，优先选 desktop profile |
| 安装内容 | `dsh-jumpserver@0.4.0`（`lib/` + `cordis.patch.yml` + `package.json` + `README.md`） |
| 安装方式 | `dsh plugin --profile desktop add github:pc439527/dsh-jumpserver`；或 profile `package.json` 增加 `"dsh-jumpserver": "file:<plugin-workspace>"` 并在 `dsh.profile.bundles` 追加 `dsh-jumpserver`，随后用内置 pnpm 安装 |
| 一致性校验 | 部署副本的 `lib/index.js`、`lib/client.js`、`package.json` 与仓库构建产物 **SHA256 逐字节一致** |
| 依赖 | `ssh2` / `zod`。若运行环境缺少 C++ 工具链导致 `cpu-features` 原生构建失败，ssh2 会自动退回纯 JS 实现，功能不受影响 |
| 生效方式 | **需要完全重启 DSH Desktop**，Host 在启动时装载插件；随后硬刷新界面 |

顺带修掉两个打包缺陷（提交 `a5074c6c6`）：`files` 只含 `lib` 导致安装副本丢失 `cordis.patch.yml`（少它插件无法被装载）；`sync-profile.mjs` 写死 web profile，现按 `JS_PROFILE_PKG` → `$DSH_PROFILE_DIR` → 自动探测 的顺序解析。

**Desktop 原生化已完成**：设置卡片走 `ctx.configForms`，密码走 `ctx.remote.credentials`，控制台由 `ctx.sidebarRight.openTab('browser', …)` 在右栏打开；`dsh-better-sidebar` 依赖与其注入元数据已全部移除。Host 工具（25 个）与右栏控制台均可直接使用。

**回滚**：恢复 profile `package.json` 的安装前备份（`sync-profile` 会在同步前生成带版本后缀的 `.bak-*` 副本），并删除安装副本目录 `node_modules/dsh-jumpserver`，即回到安装前状态。

## 7. 已知验证边界

`scripts/plugin-load-smoke.mjs` 无法在本工作区独立运行：它需要宿主提供的 `@deepseek-ai/*` peer（如 `@deepseek-ai/dsh-storage`，被 `dsh-storage-domain` 依赖），这些在 DSH 应用内由宿主解析、workspace 中不存在。因此本轮的验证是：仓库侧 typecheck / **490 个用例** / build / client bundle smoke / 工具表预算全绿，加上部署副本与构建产物的逐字节一致性；"应用真正装载"这一步需要重启后由 `jumpserver_status` 确认 `pluginVersion 0.4.0`。

## 8. desktop 适配调研与内置控制台（V0.4.0）

**调研问题**：desktop 版 DSH 如何接入侧边栏？

**结论**：
1. **desktop 与 web 跑的是同一套客户端运行时** —— desktop profile 的 `dsh.profile.bundles` 里就是 `@deepseek-ai/dsh-web-app`，带 `dsh.client.platform: web` 的客户端插件在 desktop 上同样生效；不存在 desktop 专用的 UI 接口。
2. **`dsh-better-sidebar` 是独立可安装的第三方插件，不是 desktop 专属** —— 它自己的 `dsh.client.inject` 是核心服务 `['slots','sessions','workspaces','locale','modules']`，并往 `settings.section` / `conversation.chat.turnTail` 注册，再 `ctx.provide('betterSidebar', service)` 供别的插件使用。
3. **真正的缺陷在插件这一侧**：浏览器半边把 `betterSidebar` 写进了必需的 `inject` 列表。没装 better-sidebar 时 cordis 不会激活这个客户端模块，于是**连设置卡片都不出现**——这正是"插件适配未 desktop"的观感来源。

**已修**：`betterSidebar` 变为**可选**。设置卡片只依赖核心服务（`slots/locale/settingsScope/connection`），终端标签与授权后自动打开只在服务存在时注册；缺 better-sidebar 只降级，不再整体失效。

**新增内置控制台**（"改为控制台"路线，desktop 无需任何客户端插件）：
- `src/runtime/console.ts`（服务）+ `src/runtime/console-page.ts`（自带页面，无 CDN/框架）；
- 只绑定 `127.0.0.1`；每进程随机令牌（HttpOnly/SameSite Cookie；Token 不进入 URL、HTML、日志或工具结果）；未注册路径一律 404；CSP 不含任何远程来源；
- API 直接挂载插件**现有的 bridge 路由**（`registerBridgeRoutes`），所以会话授权、状态机、人工输入的一次性确认挑战、审计行为与侧栏完全一致；
- 页面含 **终端 / 资产 / 任务 / 审计** 四个标签，拒绝记录显示为「已拦截 / 未批准 + 原因」；
- 配置 `consoleEnabled`（默认 true）/ `consolePort`（默认 **8766**，提供稳定的 Desktop 右栏地址；该端口被占用时自动回退到 OS 指定的回环端口，设为 0 则直接用随机回环端口）；`jumpserver_status` 返回本对话的 `consoleUrl`，Host 启动日志打印基础地址。

## 9. 同步边界（务必如实理解）

本分支的同步是 **Core / function sync**，不是 Console UI 等价：

- **Core 已同步**：Job 生命周期与 Ctrl+C、Host Key、目标作用域、Inspect/Topology/Runbook/Baseline、Risk Judge、多账号、拒绝审计、PTY 会话隔离。
- **Console UI 只同步了一部分**：实际渲染的只有 **终端 / 资产 / 任务 / 审计** 四个标签，WorkBuddy 的 Topology / Stats / Sessions / Settings 标签**未实现**；`ConsoleTabId` 已收窄为这四项，避免声明不存在的能力。
- **有意保留差异**：WorkBuddy 的实例选择器与 console token 轮换模型未移植。
