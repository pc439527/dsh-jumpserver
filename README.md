# dsh-jumpserver

> DeepSeek Harness（DSH）Desktop 的 **JumpServer / KoKo 堡垒机桥接插件**。
>
> 让 Agent 通过已有的 JumpServer / KoKo 堡垒机访问授权服务器：在同一条持久 SSH/PTY 会话中完成排查、采集、日志分析、跨节点对比与多服务器切换，并在 DSH 右栏提供**实时终端镜像 + 人工可接管 + 任务/审计**的内置控制台。
>
> 仅面向 **DSH Desktop 0.2.x**（Node 22.19+）。设置卡片走 DSH 原生 `configForms`，控制台走原生 `sidebarRight` Browser Tab，**不依赖任何第三方侧栏插件**。

## 快速开始

```bash
# 1. 安装（lib/ 已随仓库提交，无需本地构建）
dsh plugin --profile desktop add github:pc439527/dsh-jumpserver

# 2. 重启 DSH Desktop —— Host 在启动时装载插件，只替换磁盘文件不会生效
```

然后在**设置 → 插件 → JumpServer** 填写堡垒机 host / 端口 / 用户名 / 密码（推荐权限模式 `READ_ONLY`），点卡片内的 **测试连接** 验证（独立一次性会话，不打扰正在运行的 Agent 会话）。

在对话中下达任务：

```text
/jumpserver 检查两台服务器的 CPU、内存、磁盘并对比
```

未授权时所有 `jumpserver_*` 工具返回 `JUMPSERVER_NOT_ARMED`。持续授权用 `/jumpserver on`，用 `/jumpserver off` 撤销。裸 `/jumpserver` 只显示帮助、不会授权。

> 完整的环境要求、升级回滚、配置字段与故障排查见下方各节。

## 核心能力

- **持久会话**：每条对话一条独立 SSH/PTY 会话，绝不逐命令重连。显式状态机 `DISCONNECTED → CONNECTING → JUMPSERVER_MENU → ENTERING_ASSET → ASSET_SHELL → COMMAND_RUNNING`，非法迁移落 `UNKNOWN` 而非猜测当前服务器。
- **会话授权**：工具默认 LOCKED，只有执行 `/jumpserver` 后当前对话才获得授权，按对话隔离。
- **权限闸门 + 拒绝审计**：READ_ONLY / AUTO / FULL_ACCESS 三级逐命令约束；每一次拒绝都留痕（规则拒绝记 `BLOCKED`、未获批准记 `DENIED`）。
- **命令结果语义**：`commandStatus`（SUCCESS / EXIT_NONZERO / TIMEOUT / INTERRUPTED / CONNECTION_LOST）描述命令本身——`jps -lv` 退出 127 不再显示为成功。
- **多账号资产**：目标有多个授权用户时插件绝不替你猜，省略 `accountIndex` 会返回 `ACCOUNT_SELECTION_REQUIRED` 并保留会话，下次带上编号原地作答。
- **不可达快速失败**：堡垒机拨不通目标时归为 `ASSET_UNREACHABLE`、会话留在菜单、该目标进入 2 分钟冷却，重复进入在写入 PTY 之前就被拒绝。
- **目标范围**：`allowedTargets` / `deniedTargets` 支持精确 / 前缀 / glob / CIDR，deny 优先，越界目标在**进入之前**被拒。
- **主机密钥**：设置 `hostFingerprint` 则只接受逐字节一致的密钥；未设置时 TOFU 记录到 `~/.dsh/jumpserver/known_hosts.json`，矛盾返回 `HOST_KEY_MISMATCH` 且绝不自动重新信任。
- **资产发现**：向 KoKo 菜单发只读 `p` 抓取授权资产，本地过滤，带 footer 校验与缓存。
- **批量与巡检**：`jumpserver_batch` 一次跨多目标多命令（单目标一次进入）；`jumpserver_inspect` 用预审只读探针产出结构化主机画像；`jumpserver_topology` / `jumpserver_profile_run` / `jumpserver_baseline_*` 覆盖拓扑、runbook 与漂移检测。
- **流式任务**：`jumpserver_job_*` 处理 `tail -f` 这类不会自己结束的命令，游标读只取增量，停止幂等。
- **内置控制台**：仅绑定 `127.0.0.1` 的自带页面运维控制台，含**终端 / 资产 / 任务 / 审计**四个标签，可人工接管并同样审计。

## 工具列表（25）

> 全部受会话授权约束。`jumpserver_run` 是日常首选（自动连接 / 切换 / 验证 / 执行）。

| 工具 | 说明 |
|---|---|
| `jumpserver_status` | 当前状态、连接来源（profile/settings）、缺失项 |
| `jumpserver_connect` / `jumpserver_enter` | 建立会话等待菜单 / 进入目标并探针验证（支持 `accountIndex`） |
| `jumpserver_assets` | 资产发现（`p` + footer 校验 + 缓存；filter / group / refresh） |
| `jumpserver_run` / `jumpserver_exec` | 单命令执行（前者自动切换目标，后者仅在已进入的目标上） |
| `jumpserver_batch` | 多目标多命令，target affinity |
| `jumpserver_leave` / `jumpserver_close` | 退回菜单 / 释放全部资源 |
| `jumpserver_inspect` | 固定只读探针 → 结构化主机画像 |
| `jumpserver_topology` | 带 confidence + evidence 的主机关系图 |
| `jumpserver_compare` | 同一命令跑多目标 → 分组 + 缺失/多出行（order-insensitive） |
| `jumpserver_profile_run` | 命名 runbook 跨目标执行 + `expect` 断言 → PASS/FAIL |
| `jumpserver_baseline_capture` / `_compare` | 命名基线快照 / 漂移报告 |
| `jumpserver_job_start` / `_read` / `_stop` / `_jobs` | 流式任务：启动 / 游标读 / 幂等停止 / 列出 |
| `jumpserver_interrupt` | 立即 Ctrl+C（任务优先，单次信号），随后复验 shell |
| `jumpserver_snapshot` | 读最近终端镜像事件 |
| `jumpserver_triage` | 固定只读诊断采集（linux base + 错误窗口 + 应用自动识别），证据进案件账本 |
| `jumpserver_case` | 调查案件管理（new / summary / evidence / hypothesis / conclude / report） |
| `jumpserver_remediate` | 计划级修复（预检 → 整计划审批 → 应用 → 事后校验）；READ_ONLY 下拒绝 |
| `jumpserver_audit` | 本对话审计轨迹（拒绝原因、风险、导出），不触碰堡垒机 |

**批量约定**：`commands[]` 里放**一条简单只读命令**，不要拼 `for`/`if` 循环、`$(...)` 或长 `&&` 一段式——READ_ONLY 逐命令静态分类，复杂或写型结构会被拦截。需要固定探针时用 `jumpserver_inspect`，不要自己发明 shell 采集。

## 配置（设置页）

| 配置 | 默认 | 说明 |
|---|---|---|
| 启用 JumpServer | true | 关闭后所有工具返回 DISABLED |
| host / port | - / 2222 | 传输网关 |
| username | - | JumpServer 登录用户名 |
| password / passwordEnv | 只写 SecretField / JUMPSERVER_PASSWORD | 写入凭据域（credential-ref），连接时解析、不缓存，**永不进入任何响应 / 日志 / 终端 / tool result** |
| profiles / activeProfileId | [] / - | 多账号 `{ id, label, host, port, username, passwordEnv }`，选中者优先 |
| hostFingerprint / knownHostsPath | - / `~/.dsh/jumpserver/known_hosts.json` | 固定指纹 / TOFU 存储 |
| connectTimeout / commandTimeout / idleTimeout | 15s / 60s / 30min | 连接 / 命令 / 空闲超时 |
| permissionMode | READ_ONLY | 只读 / AUTO / 完全开放 |
| privilegedReadInReadOnly | false | READ_ONLY 下是否放行 sudo + 只读命令 |
| manualPermissionMode | CONFIRM_MODIFY | 人工终端输入策略（FOLLOW_AGENT / CONFIRM_MODIFY / FULL_ACCESS） |
| allowedTargets / deniedTargets | [] / [] | 目标范围；deny 优先 |
| batchConcurrency / maxSessions | 1 / 4 | 单次批量并行目标数 / 同时进入目标数上限 |
| timeZone | Asia/Shanghai | 审计时间显示时区（存储始终 UTC） |
| assetCacheTtlSeconds / assetGroups | 300 / {} | 资产缓存时长 / 资产组别名 |
| runbooks | {} | 命名 runbook：`{ title, steps[] }`，可带 `expect` 断言 |
| riskJudge | {} | 可选语义裁决，**默认关闭**；API Key 只经 credential-ref 解析 |
| consoleEnabled / consolePort | true / 8766 | 内置控制台，仅绑定 127.0.0.1；端口被占用时自动回退到随机回环端口 |
| autoReconnect / enableAudit | true / true | 空闲断线自动重连 / 命令审计 |
| autoOpenTerminal / terminalScrollback | true / 5000 | 授权后自动打开控制台 / 终端保留行数 |

## 内置控制台

调用 `jumpserver_status` 返回的 `consoleUrl` 就是本对话的控制台地址，粘贴进浏览器即可；DSH Desktop 右栏也会用 Browser Tab 打开同一页面。

| 标签 | 内容 |
|---|---|
| **终端** | 实时 PTY 镜像、跟随与清屏、人工输入（菜单态支持 `p` / IP 或名称 / `q` / `exit`） |
| **资产** | 最近一次 `p` 的资产列表：搜索、资产组与节点筛选 |
| **任务** | 本对话流式任务的状态、目标、命令、**停止**与**中断** |
| **审计** | 风险 / 结果筛选、搜索、CSV/JSON/Markdown 导出；拒绝记录显示为「已拦截 / 未批准 + 原因」 |

**安全模型**（三条必须同时成立）：① 只绑定 `127.0.0.1`；② 每进程随机令牌只存在于 Host 内存与 HttpOnly / SameSite=Strict Cookie，不进入 URL、HTML、日志或工具结果，并做 Host/Origin/Sec-Fetch-Site 校验；③ 控制台 API 就是侧栏用的**同一套 bridge 接口**，只增加通道、不新增策略。

## 权限模式

| Risk | READ_ONLY | AUTO | FULL_ACCESS |
|---|---|---|---|
| READ | 执行 | 执行 | 执行 |
| PRIVILEGED_READ | 拒绝（可配置放行） | 执行 | 执行 |
| UNKNOWN | 拒绝 | 审批 | 审批 |
| MODIFY | 拒绝 | 审批 | 执行 |
| DANGEROUS | 拒绝 | 审批 | 审批 |

READ_ONLY = Allowlist + 危险语法检测（宁可误拦）。修改类命令执行前强制目标验证。人工终端输入属于用户明确操作，绕过 Agent 权限门，但经 SessionManager 执行且**同样被审计**。

## 安全设计

1. **会话授权边界**：授权只经 `/jumpserver` 命令（UI 直发，不发给模型），按对话隔离。
2. **凭据**：credential-ref + `role('secret')`，连接时解析、不缓存；不进入 tool result / 日志 / 审计 / 错误信息 / 终端事件 / 浏览器响应。
3. **目标范围与验证**：deny 优先、裸条目精确匹配；越界目标在进入前被拒；进入未验证即状态 UNKNOWN，修改类命令被拒。
4. **主机密钥**：固定指纹或 TOFU，矛盾即 `HOST_KEY_MISMATCH`。
5. **Agent 权限模式**：逐命令静态分类（word-aware，含 sudo/env/timeout 包装与 watch/strace 内层命令穿透，任意深度不降级）。
6. **语义裁决**：仅 `UNKNOWN` 外发，其余风险级别永不外发；默认只作参考，`autoAllow` 需全阈值通过。
7. **拒绝审计**：`BLOCKED` / `DENIED` 各恰好一条记录并带原因，best-effort——审计故障不会把拒绝变成执行。
8. **断线语义**：命令执行中断线返回 UNKNOWN，**绝不自动重执行**；超时先 Ctrl+C + 探针复验。
9. **并发**：单会话 Mutex 串行；`maxSessions` 由进程级 Semaphore 限制同时进入的目标数。

## 当前状态

版本 **0.4.0**，`PROTOCOL_VERSION` 4。以下状态经 `npm run typecheck` + `npm test`（**490 用例 / 60 个测试文件**）+ `npm run check:lib` 实测核对。

**已实现并有测试覆盖**：上述全部能力、25 个工具、内置控制台四标签、凭据 credential-ref。

**部分接线**：
- `jumpserver_compare` ✅ 已统一到分组 + 多重集 outlier 实现
- `jumpserver_triage` / `jumpserver_remediate` ⏳ 仍使用自有的诊断 profile，**未复用** `jumpserver_inspect` 的固定只读探针——「巡检」与「诊断采集」目前是两套并行实现

**未接线**：`src/runtime/asset-store.ts`、`src/runtime/topology-store.ts` 两个类暂无实例化点，计划供侧栏使用。

**未实现**：拓扑 / 统计 / 会话 / 设置控制台标签、跨进程实例选择器、控制台 token 轮换；JumpServer REST API / Access Key；MFA 自动处理；RDP / VNC / SFTP / 文件传输 / 数据库终端。

## 已知限制

- 仅支持 JumpServer 终端菜单形态的 SSH 交互资产。
- 单堡垒机配置（多账号以 `profiles` 切换，非并行）；一条对话一条 PTY。
- 终端为「线性镜像」，不完整模拟光标定位 / 全屏程序（`top` 等显示为原始字节流；流式场景用 `jumpserver_job_*`）。
- 命令分类按词法拆分（引号内 `|` 等边界可能误拦，宁可误拦）；无法确认的标为 `UNKNOWN` 而非「修改」。
- 内置控制台由多对话共用，URL 带 `session=` 限定到某个对话。

### 实测确认的行为（不是待办）

- **命令成功但无输出**：远端 PTY 的 canonical 行规程对单行有约 4KB 上限，超长单行响应会被远端丢弃而命令仍 exit 0。插件会附带 `outputNote` 说明；规避方式是先 `| wc -c` 确认，或 `| jq` / `| fold -w 200` 折行。
- **终端里的乱码字符**：堡垒机用退格符刷新进度数字，控制台按终端语义实现了 BS 删字符与孤立 CR 覆盖重绘。
- **风险裁决未生效**：语义副驾只对 `UNKNOWN` 命令发起咨询，且只在即将弹出人工审批时触发；READ_ONLY 下未知命令被直接拒绝、不进入审批，因此裁决器没有介入点。要验证链路请把 `permissionMode` 改为 AUTO。

## 故障排查

| 现象 | 处置 |
|---|---|
| JUMPSERVER_NOT_ARMED | 先执行 `/jumpserver <任务>` 或 `/jumpserver on` |
| NOT_CONFIGURED / DISABLED | 检查设置页 host/username/密码，或 `profiles` 选中项 / 启用开关 |
| TARGET_DENIED | 目标不在 `allowedTargets` 或命中 `deniedTargets` |
| ACCOUNT_SELECTION_REQUIRED | 用返回 `detail` 里的编号重新调用并带上 `accountIndex`（会话仍在同一提示上，无需重连） |
| ASSET_UNREACHABLE | 堡垒机网络到不了该资产：**不要重试**，等冷却过去或换目标 |
| HOST_KEY_MISMATCH | 核实变更后更新 `hostFingerprint` 或 known_hosts |
| AUTH_FAILED | 用户名/密码错误，或启用了 MFA / 键盘交互 |
| COMMAND_BLOCKED | READ_ONLY 拒绝，或用户拒绝审批（审计里对应 BLOCKED / DENIED） |
| COMMAND_TIMEOUT / UNKNOWN_STATE | 已先 Ctrl+C 并复验 shell；无法确认位置时重连后再试 |
| 设置页看不到 JumpServer 卡片 | 确认已构建（`lib/client.js` 存在）；仍无 → 检查启动日志里 client-modules 组合错误 |
| GitHub 安装后插件无反应 | 安装副本缺 `lib/` 即 Host 入口缺失，DSH 加载会**静默失败**。自查 `ls ~/.dsh/profiles/*/node_modules/dsh-jumpserver/lib` |

## 开发

```bash
npm install --legacy-peer-deps
npm run typecheck      # host + client 双侧类型检查
npm test               # 490 用例 / 60 文件
npm run build          # tsc -> lib/ + esbuild -> lib/client.js + build-meta
npm run check:lib      # 守卫：已提交的 lib/ 必须与 src/ 重新构建逐字节一致
npm run check:sanitize # 守卫：全量扫描跟踪文件，禁止凭据/真实内网地址/本机绝对路径
npm run sync           # build + 同步进 Desktop profile 安装副本
```

**改完 `src/` 必须重新构建并把 `lib/` 一起提交。** GitHub 安装直接吃仓库里已提交的产物，漏提交就会装到一个「装上了但不运行」的旧版本——这是本插件静默失效最常见的原因。`npm run check:lib` 会在 CI 中拦下这种提交。

GitHub Actions CI（typecheck + vitest + build + classifier 门槛 + e2e + client bundle smoke，以及独立的 `lib-fresh` / `sanitize` job）在 main 与 PR 上运行，覆盖 Ubuntu 与 Windows × Node 22.19.0。

## License

MIT
