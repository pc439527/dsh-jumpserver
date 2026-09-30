# dsh-jumpserver

> DeepSeek Harness（DSH）的 **JumpServer / KoKo 堡垒机桥接插件**（Host + Client 双侧）。
>
> 让 Agent 通过组织已有的 JumpServer / KoKo 堡垒机访问授权服务器：在同一持久 SSH/PTY 会话中自主完成服务器排查、信息采集、日志分析、跨节点对比与多服务器切换，并在 DSH 右侧栏提供**实时终端镜像 + 人工可接管 + 任务/审计**的标签页。
>
> 当前版本：**V0.4.0**（`jumpserver_status` 返回 `pluginVersion / hostBuild / protocolVersion`）。
> 本版本把 WorkBuddy 侧 `jumpserver-mcp` v0.5.13 的核心能力同步回插件，逐文件映射见 [docs/WORKBUDDY_SYNC_0.5.13.md](docs/WORKBUDDY_SYNC_0.5.13.md)。

<img width="1920" height="945" alt="a3070d99cfbb293dd3b2e2b06c72e380" src="https://github.com/user-attachments/assets/d1eb386f-830a-4bf1-ab96-15d5cbf421d2" />

## 特性

- **持久 SSH/PTY 会话**：每个对话一条独立会话，绝不逐命令重连；显式状态机 `DISCONNECTED → CONNECTING → JUMPSERVER_MENU → ENTERING_ASSET → ASSET_SHELL → COMMAND_RUNNING → …`，非法迁移一律落 `UNKNOWN`，禁止猜测当前服务器。
- **会话授权（Session Grant）**：所有 `jumpserver_*` 工具默认 **LOCKED**——只有用户执行 `/jumpserver <任务>`（单轮，Agent 空闲即自动锁回）/ `/jumpserver on`（持续）/ `/jumpserver off`（撤销并清理）后，当前对话才获得授权，按对话隔离。
- **权限闸门 + 拒绝审计**：READ_ONLY / AUTO / FULL_ACCESS 三级逐命令约束；**每一次拒绝都留痕**——规则拒绝记 `BLOCKED`、未获批准记 `DENIED`，各恰好一条，审计后端故障也绝不会把拒绝变成执行。
- **命令结果语义**：`executionState` 只说传输交换是否完成，`commandStatus`（SUCCESS / EXIT_NONZERO / TIMEOUT / INTERRUPTED / CONNECTION_LOST / UNKNOWN）说**命令本身**发生了什么——`jps -lv` 退出 127 不再显示为成功。
- **多账号资产（KoKo 选择屏）**：目标有多个授权用户时，KoKo 会画出编号列表并等待输入。插件**绝不替你猜**：省略 `accountIndex` 会返回 `ACCOUNT_SELECTION_REQUIRED` 并带上解析出的账号列表，**会话保持存活**在同一提示上，下一次调用带上编号即可原地作答（无需重连、不向陌生屏幕写字节）。
- **不可达资产快速失败**：KoKo 无法拨通目标时会打印网络错误并退回自己的提示符。插件把它归为 `ASSET_UNREACHABLE`（整行 banner 进 `detail`）、**会话留在菜单不重连**、该目标进入 2 分钟冷却（重复进入在**写入 PTY 之前**就被拒绝），并输出 `next: STOP` 阻止模型反复重试。非网络失败仍可重试。
- **目标范围（target scope）**：`allowedTargets` / `deniedTargets`，deny 优先；条目支持精确 / 前缀 / glob / CIDR，裸条目按**精确**匹配（`192.168.79.10` 不再匹配 `.100`）。检查发生在**进入之前**，越界目标不会开启任何 PTY。
- **主机密钥校验**：设置 `hostFingerprint` 则只接受逐字节一致的密钥；未设置时首次信任并记录（TOFU，`~/.dsh/jumpserver/known_hosts.json`），此后必须一致，矛盾返回 `HOST_KEY_MISMATCH` 且**绝不自动重新信任**。
- **资产发现**：向 KoKo 菜单发送只读命令 `p` 抓取本账号授权资产，本地按 name/ip/platform/node/comment 过滤；KoKo footer 校验 + 健康度 + 5 分钟缓存（仅缓存成功结果）；支持 `assetGroups` 资产组别名。
- **批量执行**：`jumpserver_batch` 一次调用跨多目标多命令，target affinity——一台目标一次进入，全部命令跑完再退出切换。
- **固定探针巡检**：`jumpserver_inspect` 用**预审只读探针**（basic/network/process/service/web/java/database/container/full）产出结构化主机画像；探针若不再分类为 READ 会**跳过并上报**，绝不静默降级。`jumpserver_topology` 在其上构建带 confidence + evidence 的关系图。
- **Runbook 与基线**：`jumpserver_profile_run` 执行命名 runbook（同一套步骤跑遍所有主机，`expect` 断言产出 PASS/FAIL 判定，非 READ 步骤跳过上报）；`jumpserver_baseline_capture` / `_compare` 做命名快照与**漂移检测**（端口/磁盘/服务/角色/内核；load 与内存抖动被抑制，不可达主机报 unreachable 而非"无变化"）。
- **流式任务**：`jumpserver_job_start` 启动 `tail -f` / `journalctl -f` / `tcpdump` 这类不会自己结束的命令，`jumpserver_job_read` 用**游标**（`nextSeq` → `sinceSeq`）只取增量，`jumpserver_job_stop` 结束；任务运行期间独占 PTY（其它命令得到 `SESSION_BUSY`），到 `maxDuration` 自动停止。`jumpserver_interrupt` 与侧栏「中断」共用**唯一中断入口**——一次 Ctrl+C，绝不重复。
- **语义风险裁决（可选，默认关闭）**：分类器给出 `UNKNOWN` 的命令，可征询 TypeSafe System One（Jev）的结构化第二意见，**只作为审批文案里的参考**；`riskJudge.autoAllow` 打开后，通过全部阈值与结构否决的判定才可跳过人工确认，并在审计里记 `AUTO_ALLOWED`。任何失败（未启用/无凭据/超时/非 2xx/畸形响应）静默降级为普通审批。
- **多账号身份**：`profiles` + `activeProfileId` 可在设置页保存并切换多套堡垒机身份（host/port/username + credential-ref），选中者优先；密码始终只经凭据域解析，绝不落盘到插件目录。
- **实时终端镜像 + 人工输入 + 任务/审计侧栏**：所有 PTY 输入/输出/目标事件经 `TerminalObserver` 有界事件流（seq）供侧栏渲染；侧栏含 **终端 / 资产 / 任务 / 审计** 四个标签，人工输入经 SessionManager 执行并同样审计，拒绝记录以「已拦截 / 未批准」呈现而非红色失败。
- **内置控制台（Desktop 友好）**：Host 在 127.0.0.1 上提供一个**自带页面**的运维控制台（终端镜像 / 资产 / 任务 / 审计），URL 由 `jumpserver_status` 返回（不含令牌；对话 ID 通过 URL fragment 传递）。它**不依赖任何第三方插件**——Desktop 直接用 DSH 原生 `sidebarRight` Browser Tab 打开。
- **凭据安全**：密码走 DSH 凭据域 credential-ref（`passwordEnv`），连接时解析、不缓存，绝不进入 tool result / 日志 / 审计 / 终端事件 / 浏览器响应。

## 架构

```text
src/
├── index.ts                插件入口（装配 + 生命周期 + 桥接接线）
├── config/                 Config schema（schemastery）+ 类型 + 解析器
├── jumpserver/
│   ├── client.ts           ssh2 适配 + Wire 抽象 + 主机密钥校验
│   ├── session.ts          会话核心（状态机 + 账号选择 + 不可达冷却 + 命令结果）
│   ├── session-manager.ts  Mutex 队列 / 断线重连 / 审计 / runTargetBatch / 任务归属
│   ├── command-status.ts   命令结果 → 错误码的唯一映射
│   ├── host-key.ts         TOFU / 固定指纹存储
│   ├── profiles.ts         inspect 探针注册表（固定只读命令）
│   ├── inspector.ts        多目标巡检（探针 → HostInventory）
│   ├── host-parse.ts       主机输出解析（端口/磁盘/进程/服务/角色/Nginx/Java/容器）
│   ├── topology.ts         带 confidence + evidence 的关系图
│   ├── compare.ts          跨目标输出分组 + 多重集 outlier
│   ├── runbook.ts          命名 runbook + expect 断言
│   ├── concurrency.ts      Semaphore（maxSessions）
│   └── state-machine / detector / probe / command-runner / output-buffer / mutex / timing
├── runtime/
│   ├── job-store.ts        流式任务（按对话隔离 + 游标读 + 幂等停止）
│   ├── interrupt.ts        唯一中断入口（任务优先，否则裸 shell）
│   ├── baseline-store.ts   命名基线 + 漂移 diff
│   ├── time.ts             审计时区格式化
│   └── paths.ts            <dsh home>/jumpserver 状态目录
├── bridge/
│   └── bridge.ts           /api/jumpserver.{status,snapshot,manual,assets,audit,classify,test,jobs,jobStop,interrupt}
├── security/               command-classifier / sql-command-classifier / permission / permission-gate / risk-judge / target-scope / audit / manual-policy / grant
├── ops/                    triage 采集 / 应用 profile / 证据账本与案件
├── tools/                  definitions（核心）/ ops（案件·修复）/ jobs（任务）/ inspection（巡检）/ common（输出契约）
└── client/                 DSH Desktop 原生 settings card / Browser Tab 入口（构建为 lib/client.js）
```

核心设计：**传输主机（Transport Host）≠ 逻辑目标（Logical Target）**。一个 ssh2 PTY Channel 复用于整个会话；进入目标后执行随机探针（hostname/whoami/pwd）验证，验证成功才置 `ASSET_SHELL`；命令完成用唯一 Completion Marker 判定并返回真实 exit code。

## 安装

面向 **DSH Desktop 0.2.x**（Node 22.19+）：设置卡片走 DSH 原生 `configForms`，终端/资产/任务/审计经原生 `sidebarRight` Browser Tab 打开内置控制台，无需任何第三方侧栏插件。

```bash
# ① 构建本插件（生成 lib/，含 lib/client.js 浏览器 bundle）
npm install --legacy-peer-deps
npm run build

# ② 安装 dsh-jumpserver

## 本地源码方式（等价于 DSH「添加插件」弹窗里复制出的命令）：
dsh plugin --profile web add "file:<本插件所在路径>"
## 发布到 npm 后可直接：
dsh plugin --profile web add dsh-jumpserver
## 或直接从 GitHub 仓库安装（收录清单要求的可安装方式）：
dsh plugin --profile web add github:pc439527/dsh-jumpserver
```

**更新已安装的插件**（Host 与浏览器 half 分开发布，只改源码不会生效）：

```bash
npm run sync        # build（tsc + client bundle + build-meta）+ sync-profile 同步进 profile 安装副本
```

然后重启 `dsh web`（Host 启动时加载），并**硬刷新浏览器**（Ctrl/Cmd+Shift+R）——侧栏头部会以 Host/Client 版本不一致提示你这一条。

## 快速开始

### 1. 在设置页配置连接

**设置 → 插件 → JumpServer** 卡片填写：堡垒机 host/port、JumpServer 用户名、密码（`passwordEnv` 指向凭据域，如 `JUMPSERVER_PASSWORD`）、权限模式（推荐 `READ_ONLY`）。卡片内置 **测试连接** 按钮（独立一次性会话，不触碰正在运行的 Agent 会话）。

### 2. 授权并下达任务

```text
# 单轮授权（任务直接交给 Agent，本轮结束自动锁回）：
/jumpserver 检查两台服务器的 CPU、内存、磁盘并对比

# 持续授权：
/jumpserver on          # 直到 /jumpserver off
```

> 未授权时所有 `jumpserver_*` 工具统一返回 `JUMPSERVER_NOT_ARMED`；裸 `/jumpserver` 只显示帮助、不会授权。

### 3. 典型使用

```text
用户：/jumpserver 检查 web-app-01 / web-app-02 的 CPU、内存、磁盘、负载和错误日志，并对比两个节点。

Agent 在本轮内完成：
jumpserver_batch(tasks=[
  {target: "203.0.113.101", commands: ["hostname", "uptime", "free -m", "df -h", "ps -eo pid,user,%cpu,cmd --sort=-%cpu | head -20", "tail -n 300 /var/log/app.log"]},
  {target: "203.0.113.102", commands: ["hostname", "uptime", "free -m", "df -h", "ps -eo pid,user,%cpu,cmd --sort=-%cpu | head -20", "tail -n 300 /var/log/app.log"]},
])
```

结构化巡检更省上下文：

```text
jumpserver_inspect(targets=["203.0.113.101","203.0.113.102"])   # 固定只读探针 → 主机画像
jumpserver_compare(targets=[...], command="ss -lntp")            # 谁和别人不一样（缺/多行）
jumpserver_baseline_capture(name="prod-2026-09", targets=[...])  # 记下基线
jumpserver_baseline_compare(name="prod-2026-09")                 # 之后回来了哪些漂移
jumpserver_job_start(target="...", command="tail -f /var/log/app.log")  # 不会自己结束的
jumpserver_job_read(jobId="jsjob_xxxx")                          # 只取增量
```

（示例使用 RFC 5737 文档保留地址。）

## 配置（设置页）

| 配置 | 默认 | 说明 |
|---|---|---|
| 启用 JumpServer | true | 关闭后所有 jumpserver_* 工具返回 DISABLED |
| 服务器 host / SSH 端口 port | - / 2222 | 传输网关 |
| 用户名 username | - | |
| 密码 password / 密码环境变量 passwordEnv | 只写 SecretField / JUMPSERVER_PASSWORD | 写入凭据域（credential-ref），连接时解析、不缓存，**永不进入任何响应/日志/终端/tool result** |
| profiles / activeProfileId | [] / - | V0.4.0 多账号：`{ id, label, host, port, username, passwordEnv }`，选中者优先于上面的 host/username |
| hostFingerprint / knownHostsPath | - / `~/.dsh/jumpserver/known_hosts.json` | 固定主机密钥指纹 / TOFU 存储 |
| connectTimeout / commandTimeout / idleTimeout | 15s / 60s / 30min | 连接 / 命令 / 空闲超时 |
| permissionMode | READ_ONLY | 只读 / AUTO / 完全开放 |
| privilegedReadInReadOnly | false | READ_ONLY 下是否放行 sudo + 只读命令 |
| manualPermissionMode | CONFIRM_MODIFY | 人工终端输入策略（FOLLOW_AGENT / CONFIRM_MODIFY / FULL_ACCESS） |
| timeZone | Asia/Shanghai | 审计时间显示时区（存储始终 UTC） |
| allowedTargets / deniedTargets | [] / [] | 目标范围：精确 / 前缀 / glob / CIDR；deny 优先 |
| batchConcurrency / maxSessions | 1 / 4 | 单次批量并行目标数（1..8）/ 同时进入目标数上限（1..16，进程级） |
| assetCacheTtlSeconds | 300 | 资产列表缓存时长 |
| assetGroups | {} | 资产组别名：组名 → 关键词列表 |
| runbooks | {} | 命名 runbook：`{ title, steps[] }`，步骤为 profile 或只读 command，可带 `expect` 断言 |
| riskJudge | {} | 可选语义裁决：`{ enabled, endpoint, apiKeyEnv, model, timeoutMs, cacheTtlSeconds, redactNetwork, autoAllow{...} }`，**默认关闭**；API Key 只经 credential-ref 解析 |
| consoleEnabled / consolePort | true / 8765 | 内置控制台：仅绑定 127.0.0.1，默认 8765 固定回环端口；URL 由 `jumpserver_status` 返回 |
| autoReconnect / enableAudit | true / true | 空闲断线自动重连（最多 2 次）/ 命令审计 |
| autoOpenTerminal / terminalScrollback | true / 5000 | 进会话页自动打开侧栏标签 / 终端保留行数 |

## 工具列表（25）

> 所有 `jumpserver_*` 都受 **会话授权** 约束：未运行 `/jumpserver` 时返回 `JUMPSERVER_NOT_ARMED`。

**会话与执行**

| 工具 | 说明 |
|---|---|
| `jumpserver_status` | 当前状态 + 连接来源（profile/settings）+ 缺失项（无凭据信息） |
| `jumpserver_connect` / `jumpserver_enter` | 建立会话等待菜单 / 进入目标并 Probe 验证（支持 `accountIndex`） |
| `jumpserver_assets` | 资产发现（`p` + footer 校验 + 健康度 + 缓存；filter / group / refresh） |
| `jumpserver_exec` | 仅在已进入的目标上执行单条命令 |
| `jumpserver_run` | 自动连接/切换/验证/执行（单命令日常首选） |
| `jumpserver_batch` | 批量执行：多目标多命令，target affinity |
| `jumpserver_leave` / `jumpserver_close` | 退回菜单 / 释放全部资源 |

**巡检与对比**

| 工具 | 说明 |
|---|---|
| `jumpserver_inspect` | 固定只读探针 → 结构化主机画像（多目标，profile 可选，accountByTarget） |
| `jumpserver_topology` | 带 confidence + evidence 的主机关系图 |
| `jumpserver_profile_run` | 命名 runbook 跨目标执行 + `expect` 断言 → PASS/FAIL |
| `jumpserver_compare` | 同一命令/profile 跑多目标 → 分组 + 缺失/多出行（order-insensitive） |
| `jumpserver_baseline_capture` / `_compare` | 命名基线快照 / 漂移报告 |

**流式任务**

| 工具 | 说明 |
|---|---|
| `jumpserver_job_start` | 启动不会自己结束的命令，返回 jobId |
| `jumpserver_job_read` | 游标读（`nextSeq` → `sinceSeq`），默认只取增量 |
| `jumpserver_job_stop` / `jumpserver_jobs` | 幂等停止 / 列出本对话任务 |
| `jumpserver_interrupt` | 立即 Ctrl+C（任务优先，单次信号），随后复验 shell |
| `jumpserver_snapshot` | 读最近终端镜像事件（内部捕获流量已剔除） |

**Ops 调查（DSH 独有）**

| 工具 | 说明 |
|---|---|
| `jumpserver_triage` | 固定只读诊断采集（linux base + 错误窗口 + 应用自动识别 12 类），证据进案件账本 |
| `jumpserver_case` | 调查案件管理（new/list/summary/evidence/hypothesis/action/conclude/report） |
| `jumpserver_remediate` | 计划级修复（预检 → 整计划审批 → 应用 → 事后校验）；READ_ONLY 下拒绝 |

**审计**

| 工具 | 说明 |
|---|---|
| `jumpserver_audit` | 本对话审计轨迹（本地时间、`why=` 拒绝原因、refusalsOnly、limit/filter），不触碰堡垒机 |

### 批量约定（对模型的强约束）

- 同目标多指标 → 一次 `jumpserver_batch`，target affinity 单次进入跑完全部命令；
- `commands[]` 里放**一条简单只读命令**（如 hostname、free -m、df -h），**不要**拼 for/if 循环、`$(...)` 或长 `&&`/`;` 一段式——`READ_ONLY` 逐命令静态分类，复杂或写型 shell 结构会被拦截；
- 需要固定探针时用 `jumpserver_inspect`，不要自己发明 shell 采集；
- 多目标 → 每个目标一个 tasks 条目；完成一个目标的所有命令后才切换目标。

## 控制台（desktop 版本推荐）

Desktop 版使用 DSH 原生服务：设置页经 `ctx.configForms.get('jumpserver')` 注册到插件设置区，密码写入 `ctx.remote.credentials`；授权后由 `ctx.sidebarRight.openTab('browser', …)` 在右栏打开控制台。不依赖任何第三方侧栏插件。

- **入口**：调用 " + BT + "jumpserver_status" + BT + "，返回的 " + BT + "consoleUrl" + BT + " 就是本对话的控制台地址（Host 启动日志里也会打印基础地址）。直接粘贴进浏览器打开即可。
- **内容**：**终端**（实时 PTY 镜像，输入黄/输出绿/系统蓝，人工输入支持菜单态 " + BT + "p" + BT + " / IP 或名称 / " + BT + "q" + BT + " / " + BT + "exit" + BT + "）、**资产**、**任务**（停止 / 中断）、**审计**（拒绝记录显示为「已拦截 / 未批准 + 原因」）。
- **安全模型**（三条必须同时成立）：① 只绑定 `127.0.0.1`，永不监听可路由地址；② 每进程随机令牌只存在于 Host 内存与 **HttpOnly / SameSite=Strict Cookie**（首次打开页面时下发），Token 不进入 URL、HTML、日志、`console.json` 或工具结果，且 Host/Origin/Sec-Fetch-Site 校验拒绝跨站与 Host 伪造；③ API 就是侧栏用的**同一套 bridge 接口**——会话授权、状态机、人工输入的一次性确认挑战、审计全部一致，控制台只增加通道，不新增策略。
- **不做**：不自动拉起系统浏览器（模型只把 URL 交给你），不引入跨进程实例选择器。

## 控制台标签（Desktop 右栏 Browser Tab）

| 标签 | 内容 |
|---|---|
| **终端** | 实时 PTY 镜像（输入黄/输出绿/系统蓝）、跟随与清屏、人工输入（菜单态支持 p / IP / 名称 / q / exit） |
| **资产** | 最近一次 `p` 的资产列表：搜索、资产组与节点筛选、虚拟化滚动 |
| **任务** | 本对话流式任务：状态、目标、命令、字节数/时长、**停止**与**中断**（仅在标签打开且可见时轮询） |
| **审计** | 本对话审计：风险/结果筛选、搜索、CSV/JSON/Markdown 导出（脱敏）；拒绝记录显示为「已拦截 / 未批准 + 原因」 |

## 权限模式

| Risk | READ_ONLY | AUTO | FULL_ACCESS |
|---|---|---|---|
| READ | 执行 | 执行 | 执行 |
| PRIVILEGED_READ | 拒绝（可配置放行） | 执行 | 执行 |
| UNKNOWN | 拒绝 | 审批 | 审批 |
| MODIFY | 拒绝 | 审批 | 执行 |
| DANGEROUS | 拒绝 | 审批 | 审批 |

- READ_ONLY = Allowlist + 危险语法检测（宁可误拦）；只读 FD 重定向不算写文件，`> file / >> file / tee` 仍拦截。
- 修改类命令执行前强制目标验证（state==ASSET_SHELL 且 hostname 已探测），无法验证则拒绝。
- 导航操作（连接/进入/退出/切换）不受权限限制，但受**目标范围**约束。
- 侧栏人工终端的输入属于用户明确操作，绕过 Agent 权限门，但经 SessionManager（mutex/状态机/审计）执行且**同样被审计**；`manualPermissionMode` 可独立配置。

## 安全设计

1. **会话授权边界**：LOCKED 状态所有工具返回 `JUMPSERVER_NOT_ARMED`；授权只经 `/jumpserver` 命令（UI 直发，不发给模型），按对话隔离。
2. **目标范围**：`deniedTargets` 优先于 `allowedTargets`，裸条目精确匹配；越界目标在**进入前**被拒（不开 PTY），返回 `TARGET_DENIED`。
3. **主机密钥**：固定指纹或 TOFU，矛盾即 `HOST_KEY_MISMATCH`，绝不自动重新信任。
4. **Agent 权限模式**：逐命令静态分类（word-aware，含 sudo/env/timeout 包装与 watch/strace 内层命令穿透，任意深度不降级）。
5. **语义裁决**：仅 `UNKNOWN` 外发，MODIFY / DANGEROUS / READ / PRIVILEGED_READ 永不外发；外发前脱敏；默认只作参考，autoAllow 需全阈值通过。
6. **拒绝审计**：`BLOCKED` / `DENIED` 各恰好一条记录并带原因，best-effort——审计故障不会改变放行结果。
7. **凭据**：credential-ref + role('secret')，连接时解析、不缓存；不进入 tool result / 日志 / 审计 / 错误信息 / 终端事件 / 浏览器响应。
8. **目标验证**：进入未验证 = 状态 UNKNOWN，修改类命令被拒（`TARGET_VERIFICATION_FAILED`）。
9. **断线语义**：命令执行中断线返回 executionState UNKNOWN，**绝不自动重执行**；命令超时先 Ctrl+C + 探针复验，验证明白才可继续。
10. **并发**：单会话 Mutex，connect/enter/exec/leave/batch 串行；排队中尊重 exec.signal（取消即丢弃）；`maxSessions` 由进程级 Semaphore 限制同时进入的目标数。
11. **任务**：按对话隔离，运行期独占 PTY；停止幂等且并发安全（共享一次判定）；PTY 归属随会话生命周期释放。

## 已知限制

- 仅支持"JumpServer 终端菜单"形态的 SSH 交互资产；无 RDP / VNC / SFTP / 文件传输 / 数据库 / Web Terminal。
- 无 JumpServer REST API / Access Key；无 MFA 自动处理（遇 MFA 会报 AUTH_FAILED/超时）。
- 单 JumpServer 配置（多账号以 `profiles` 切换，非并行）；一个对话一条 PTY，多会话并行仍在规划中。
- 终端为"线性镜像"，不完整模拟光标定位/全屏程序（`top` 等交互界面显示为原始字节流；流式场景请用 `jumpserver_job_*`）。
- 命令分类按词法拆分（引号内 `|` 等边界可能误拦，宁可误拦）；无法确认的命令标为 `UNKNOWN` 而非"修改"。
- `jumpserver_job_*` 只覆盖流式输出，不提供交互式 stdin 会话。
- 内置控制台是**多对话共用**的：URL 带 `session=` 参数限定到某个对话；同一对话的多个页面各自独立游标。

## 故障排查

| 现象 | 处置 |
|---|---|
| JUMPSERVER_NOT_ARMED | 会话未授权：先执行 `/jumpserver <任务>` 或 `/jumpserver on` |
| 侧栏显示版本不一致 | 重启 dsh web Host 进程，再以 `jumpserver_status` 核对 pluginVersion / hostBuild |
| NOT_CONFIGURED | 检查设置页 host/username/密码，或 `profiles` 选中项 |
| DISABLED | 设置页"启用 JumpServer"被关闭 |
| TARGET_DENIED | 目标不在 `allowedTargets` 或命中 `deniedTargets`：改配置或换目标 |
| ACCOUNT_SELECTION_REQUIRED | 目标有多个授权用户：用返回 `detail` 里的编号重新调用并带上 `accountIndex`（会话仍在同一提示上，无需重连） |
| ASSET_UNREACHABLE | 堡垒机网络到不了该资产：**不要重试**，等冷却过去或换目标 |
| HOST_KEY_MISMATCH | 主机密钥与固定指纹/TOFU 记录不一致：核实变更后更新 `hostFingerprint` 或 known_hosts |
| AUTH_FAILED | 用户名/密码错误，或 JumpServer 启用了 MFA/键盘交互 |
| CONNECTION_TIMEOUT | 堡垒机不可达/限速；调大 connectTimeout 或先点"测试连接" |
| MENU_NOT_DETECTED | 菜单文本与内置特征不符：用 smoke 脚本的 screenTail 校准 detector fixture |
| ASSET_VERIFY_FAILED | 目标资产不可登录/探针被禁止；状态 UNKNOWN |
| COMMAND_TIMEOUT | 插件先 Ctrl+C 中断并回 shell，再探针复验——验证明白才报告"shell 可用" |
| COMMAND_BLOCKED | READ_ONLY 权限拒绝，或用户拒绝审批（审计里对应 BLOCKED / DENIED） |
| UNKNOWN_STATE | 无法确认位置；已停止执行，请 reconnect/status 后再试 |
| 设置页看不到 JumpServer 卡片 | 确认已构建（`lib/client.js` 存在）；重启后仍无 → 检查 boot 日志里 client-modules 组合错误 |

## 开发与测试

```bash
npm run typecheck          # host + client 双侧类型检查
npm test                   # vitest：状态机/检测器/分类器/权限闸门/风险裁决/会话/观察者/任务/巡检/基线/授权/资产解析/ops 等 400 用例
npm run build              # tsc -> lib/ + esbuild -> lib/client.js + build-meta
npm run smoke:client       # 浏览器 bundle 物化冒烟
npm run smoke              # 实机冒烟（需 JS_USER + JUMPSERVER_PASSWORD，可选 JS_HOST/JS_TARGET_x）
node scripts/plugin-load-smoke.mjs   # 已安装包加载冒烟
npm run sync               # build + 把 lib/ + package.json 同步进 web profile 安装副本
```

测试覆盖亮点：`tests/console.test.ts`（控制台令牌/路由/端口释放）、`tests/jobs.test.ts`（单次 Ctrl+C / 幂等停止 / 对话隔离 / 游标读）、`tests/inspection-tools.test.ts`（结构化画像 + 基线漂移往返）、`tests/risk-judge-gate.test.ts`（advisory / 失败降级 / autoAllow 与分布否决）、`tests/context-budget.test.ts`（工具表 schema 预算 28 KB）、`tests/classifier-corpus.test.ts`（READ 误判 <2%、0 误放）。

GitHub Actions CI（typecheck + vitest + build + classifier 门槛 + e2e + client bundle smoke）在 main 与 PR 上自动运行。


## 已知限制与故障排查（DSH Desktop 0.2.x）

以下均为真实堡垒机验收中确认的行为，不是待办事项。

### 命令成功但没有输出

远端 PTY 的 canonical 行规程对**单行**有约 4KB 上限。超长的单行响应（压缩过的 JSON、base64）会在远端被丢弃，而命令本身仍然 exit 0：

```
curl -s http://127.0.0.1:9090/api/v1/alerts | wc -c   # 41613  数据确实到了
curl -s http://127.0.0.1:9090/api/v1/alerts          # 空输出，exit 0
```

插件无法从外部改变堡垒机的 tty 参数，因此改为**让失败可见**：这类结果会附带 `outputNote` 说明原因。规避方式：

- `| wc -c` 先确认是否有数据
- `| jq .` / `| head` / `| fold -w 200` 折行

### 终端里的乱码字符（形如 ???0.5）

堡垒机连接进度用退格符在同一位置刷新数字。控制台已按终端语义实现 BS 删字符与孤立 CR 覆盖重绘，并与侧栏终端共用同一套规则（`src/client/ansi.ts`，由 `tests/console-terminal-strip.test.ts` 对拍保证）。

### 风险裁决（Jev）没有生效

语义副驾**只对 UNKNOWN 分类的命令**发起咨询，且只在即将弹出人工审批时触发。在 READ_ONLY 模式下未知命令被直接拒绝、不会进入审批，因此裁决器没有介入点。要验证链路请把 `permissionMode` 改为 AUTO。

API 密钥保存在 **DSH 凭据域**（设置页写入），不是环境变量。裁决失败时会在审计与结果中给出原因：disabled / no-credential / unreachable / timeout / http-error / bad-payload。`autoAllow` 默认关闭，裁决永远不会自动放行。

### 拒绝审计

BLOCKED / DENIED 都会写入审计，可用 `jumpserver_audit`（`refusalsOnly: true`）或控制台审计页查看。若写入本身失败，工具结果会带 `AUDIT_WRITE_FAILED` 前缀——此时拒绝判定不受影响，但审计承诺已破，需要排查凭据/存储层。

### npm run sync

脚本按 `JS_PROFILE_PKG` → `DSH_PROFILE_DIR` → **自动探测** `~/.dsh/profiles/*` 的顺序解析目标。`DSH_PROFILE_DIR` 只在宿主进程里存在，普通终端中会自动探测并优先选择 desktop profile。

## License

MIT
