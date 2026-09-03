# dsh-jumpserver

> DeepSeek Harness（DSH）的 **JumpServer / KoKo 堡垒机桥接插件**（Host + Client 双侧）。
>
> 让 Agent 通过组织已有的 JumpServer / KoKo 堡垒机访问授权服务器：在同一持久 SSH/PTY 会话中自主完成服务器排查、信息采集、日志分析与多服务器切换，并在 DSH 右侧栏提供**实时终端镜像 + 人工可接管**的终端标签页。
>
> 当前版本：**V0.3.1**（`jumpserver_status` 返回 `pluginVersion / hostBuild / protocolVersion`）。

<img width="1920" height="945" alt="a3070d99cfbb293dd3b2e2b06c72e380" src="https://github.com/user-attachments/assets/d1eb386f-830a-4bf1-ab96-15d5cbf421d2" />


## 特性

- **持久 SSH/PTY 会话**：每个对话一条独立会话，绝不逐命令重连；显式状态机 `DISCONNECTED → CONNECTING → JUMPSERVER_MENU → ENTERING_ASSET → ASSET_SHELL → COMMAND_RUNNING → …`，非法迁移一律落 `UNKNOWN`，禁止猜测当前服务器。
- **会话授权（Session Grant）**：所有 `jumpserver_*` 工具默认 **LOCKED**——只有用户执行 `/jumpserver <任务>`（单轮，Agent 空闲即自动锁回，30 分钟硬上限）/ `/jumpserver on`（持续）/ `/jumpserver off`（撤销并清理）后，当前对话才获得授权，按对话隔离。
- **权限闸门 + 审计**：READ_ONLY / AUTO / FULL_ACCESS 三级逐命令约束 Agent 自动工具；命令审计持久化（timestamp / operation / gateway / target / hostname / command / risk / mode / result / exitCode / duration），不含任何凭据。
- **资产发现**：向 KoKo 菜单发送只读命令 `p` 抓取本账号授权资产，本地按 name/ip/platform/node/comment 过滤；KoKo footer 校验（`parsedRows == reportedTotal`）+ 健康度（`ASSET_CAPTURE_TIMEOUT / ASSET_CAPTURE_INCOMPLETE / ASSET_PARSE_FAILED / ASSET_LIST_EMPTY`）+ 5 分钟缓存（仅缓存成功结果）；支持 `assetGroups` 资产组别名（如 `group="OA"` 按关键词 OR 匹配）。
- **批量执行**：`jumpserver_batch` 一次调用跨多目标多命令，target affinity——一台目标一次进入，全部命令跑完再退出切换。
- **Ops Investigation（V0.3.0）**：`jumpserver_triage`（固定只读诊断采集 + 应用自动识别）、`jumpserver_compare`（跨节点指标对比 + 偏差标记）、`jumpserver_case`（证据账本 E-xxx + 案件管理 + Ops 工单/RCA 初稿）、`jumpserver_remediate`（计划级修复：预检 → 一次审批整个计划 → 应用 → 事后校验，失败即停并给出 rollback 指引）。
- **实时终端镜像 + 人工输入**：所有 PTY 输入/输出/目标事件经 `TerminalObserver` 有界事件流（seq）供浏览器长轮询渲染；侧栏终端默认只读镜像，已进入目标后人工输入经 SessionManager 执行并同样审计。
- **凭据安全**：密码走 DSH 凭据域 credential-ref（`passwordEnv`，如 `JUMPSERVER_PASSWORD`），连接时解析、不缓存，绝不进入 tool result / 日志 / 审计 / 终端事件 / 浏览器响应。

## 架构

```text
src/
├── index.ts                插件入口（装配 + 生命周期 + 桥接接线）
├── config/                 Config schema（schemastory）+ 类型
├── jumpserver/
│   ├── client.ts           ssh2 适配 + Wire 抽象
│   ├── session.ts          会话核心（状态机驱动 + 输入/目标事件回调）
│   ├── session-manager.ts  Mutex 队列 / 断线重连 / 审计 / runTargetBatch
│   ├── terminal-observer.ts TerminalObserver + 有界环形缓冲（seq 事件流）
│   ├── state-machine.ts / detector.ts / probe.ts / command-runner.ts / output-buffer.ts / mutex.ts / timing.ts
├── bridge/
│   └── bridge.ts           /api/jumpserver.{status,snapshot,test} 精确路由
├── security/               command-classifier / permission / audit / manual-policy
├── ops/                    triage 采集 / 应用 profile / 证据账本与案件
├── tools/                  9 个 model-facing 工具 + 审批接线
└── client/                 浏览器 half 源码（settings 卡片 / better-sidebar 终端标签页；构建为 lib/client.js）
```

核心设计：**传输主机（Transport Host）≠ 逻辑目标（Logical Target）**。一个 ssh2 PTY Channel 复用于整个会话；进入目标后执行随机探针（hostname/whoami/pwd）验证，验证成功才置 `ASSET_SHELL`；命令完成用唯一 Completion Marker 判定并返回真实 exit code。

## 安装

终端标签页注册在 **dsh-better-sidebar** 中，因此**先装 dsh-better-sidebar，再装 dsh-jumpserver**：

```bash
# ① 构建本插件（生成 lib/，含 lib/client.js 浏览器 bundle）
npm install --legacy-peer-deps
npm run build

# ② 安装 dsh-better-sidebar（按 DSH core 版本选通道）
dsh plugin --profile web add dsh-better-sidebar@latest    # stable core
# 或 dsh plugin --profile web add dsh-better-sidebar@alpha  # alpha core

# ③ 安装 dsh-jumpserver
## 本地源码方式（等价于 DSH「添加插件」弹窗里复制出的命令）：
dsh plugin --profile web add "file:<本插件所在路径>"
## 发布到 npm 后可直接：
dsh plugin --profile web add dsh-jumpserver
## 或直接从 GitHub 仓库安装（收录清单要求的可安装方式）：
dsh plugin --profile web add github:pc439527/dsh-jumpserver
```

> 也可以让模型代劳：在 DSH 里说「帮我安装 dsh-jumpserver 插件（DSH 侧边栏 JumpServer 终端标签页 + 堡垒机工具）」，把上面的命令贴给它执行。

重启 `dsh web`（Host 在启动时加载；浏览器 half 由客户端模块系统扫描 `dsh.client` 声明后下发，**重启前请确认 `lib/client.js` 存在**），然后**硬刷新浏览器**（Ctrl/Cmd+Shift+R）即可看到侧边卡片 + 菜单里的 JumpServer 标签页。

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

> ⚠️ 未授权时所有 `jumpserver_*` 工具统一返回 `JUMPSERVER_NOT_ARMED`；裸 `/jumpserver` 只显示帮助、不会授权。

### 3. 典型使用

```text
用户：/jumpserver 检查 web-app-01 / web-app-02 的 CPU、内存、磁盘、负载和错误日志，并对比两个节点。

Agent 在本轮内完成：
jumpserver_batch(tasks=[
  {target: "203.0.113.101", commands: ["hostname", "uptime", "free -m", "df -h", "ps -eo pid,ppid,user,%cpu,%mem,cmd --sort=-%cpu | head -20", "tail -n 300 /var/log/app.log"]},
  {target: "203.0.113.102", commands: ["hostname", "uptime", "free -m", "df -h", "ps -eo pid,ppid,user,%cpu,%mem,cmd --sort=-%cpu | head -20", "tail -n 300 /var/log/app.log"]},
])
```

插件自动完成 101 全部采集 → exit → 菜单确认 → 102 全部采集，模型只分析汇总结果。（示例使用 RFC 5737 文档保留地址。）

## 配置（设置页）

| 配置 | 默认 | 说明 |
|---|---|---|
| 启用 JumpServer | true | 关闭后所有 jumpserver_* 工具返回 DISABLED |
| 服务器 host | - | JumpServer 地址（传输网关） |
| SSH 端口 port | 2222 | |
| 用户名 username | - | |
| 密码 password | 只写 SecretField | 写入凭据域（`.credentials.yaml` 的 refs），**永不出现在任何 GET 响应 / 日志 / 终端 / tool result / 模型上下文** |
| 密码环境变量 passwordEnv | JUMPSERVER_PASSWORD | credential-ref；连接时解析、不缓存 |
| 连接超时 connectTimeout | 15s | |
| 命令超时 commandTimeout | 60s | |
| 空闲断开 idleTimeout | 30min | |
| 权限模式 permissionMode | READ_ONLY | 只读 READ_ONLY / 自动 AUTO / 完全开放 FULL_ACCESS |
| 自动重连 autoReconnect | true | 空闲断线自动重连最多 2 次（1s/3s） |
| 命令审计 enableAudit | true | 命令执行审计（storageDomain） |
| 自动打开终端 autoOpenTerminal | true | 进会话页自动打开侧栏 JumpServer 标签页 |
| 终端保留行数 terminalScrollback | 5000 | 终端最大滚动行数 |
| assetGroups | {} | 资产组别名：组名 → 关键词列表，如 `{ "OA": { "keywords": ["OA", "portal", "workflow", "办公"] } }` |

## 工具列表

> 所有 `jumpserver_*` 都受 **会话授权** 约束：未运行 `/jumpserver` 时返回 `JUMPSERVER_NOT_ARMED`。

| 工具 | 说明 |
|---|---|
| `jumpserver_status` | 当前状态（无凭据信息） |
| `jumpserver_assets` | 资产发现（`p` 命令 + footer 校验 + 健康度 + 缓存；`filter? / group? / refresh? / includeRawText?`） |
| `jumpserver_connect` / `jumpserver_enter` | 建立会话等待菜单 / 进入目标并 Probe 验证 |
| `jumpserver_exec` | 仅在已进入的目标上执行单条命令 |
| `jumpserver_run` | 自动连接/切换/验证/执行（单命令日常首选） |
| `jumpserver_batch` | 批量执行：多目标多命令，target affinity |
| `jumpserver_leave` / `jumpserver_close` | 退回菜单 / 释放全部资源 |
| `jumpserver_triage` | 固定只读诊断采集（linux 基础画像 + 应用自动识别 + 错误窗口），结果进入 Investigation Case 作为 E-xxx 证据 |
| `jumpserver_compare` | 跨 2-4 节点归一化指标对比 + 偏差标记 |
| `jumpserver_case` | 调查案件管理（new/list/summary/evidence/hypothesis/action/conclude/report） |
| `jumpserver_remediate` | 计划级修复（预检 → 整计划审批 → 应用 → 事后校验）；READ_ONLY 下拒绝 |

### 批量约定（对模型的强约束）

- 同目标多指标 → 一次 `jumpserver_batch`，target affinity 单次进入跑完全部命令；
- `commands[]` 里放**一条简单只读命令**（如 `"hostname"`、`"free -m"`、`"df -h"`、`"ps -eo pid,user,%cpu,cmd --sort=-%cpu | head -15"`、`"tail -n 200 /var/log/app.log"`），**不要**拼 for/if 循环、`$(...)` 或长 `&&`/`;` 一段式——`READ_ONLY` 逐命令静态分类，复杂/写型 shell 结构会被拦截；
- 多目标 → 每个目标一个 `tasks` 条目；完成一个目标的所有命令后才切换目标。

## 权限模式

| Risk | READ_ONLY | AUTO | FULL_ACCESS |
|---|---|---|---|
| READ | 执行 | 执行 | 执行 |
| LOW（sudo 只读） | 拒绝 | 执行 | 执行 |
| MODIFY | 拒绝 | 审批 | 执行 |
| DANGEROUS | 拒绝 | 审批 | 审批 |

- READ_ONLY = Allowlist + 危险语法检测（宁可误拦）；只读 FD 重定向（`2>&1 / 1>&2 / 2>/dev/null / 2>>/dev/null / >/dev/null`）不算写文件，`> file / >> file / >&file / tee` 仍拦截。
- 修改类命令执行前强制目标验证（state==ASSET_SHELL 且 hostname 已探测），无法验证则拒绝。
- 导航操作（连接/进入/退出/切换）不受权限限制。
- 侧栏人工终端的输入属于用户明确操作，绕过 Agent 权限门，但经 SessionManager（mutex/状态机/审计）执行且**同样被审计**；`manualPermissionMode` 可独立配置（FOLLOW_AGENT / CONFIRM_MODIFY 默认 / FULL_ACCESS）。

## 安全设计

1. **会话授权边界**：LOCKED 状态所有工具返回 `JUMPSERVER_NOT_ARMED`；授权只经 `/jumpserver` 命令（UI 直发，不发给模型），按对话隔离。
2. **Agent 权限模式**：逐命令约束 Agent 自动工具（见上表）。
3. **凭据**：credential-ref + role('secret')，连接时解析、不缓存；不进入 tool result / 日志 / 审计 / 错误信息 / 终端事件 / 浏览器响应。
4. **目标验证**：进入未验证 = 状态 UNKNOWN，修改类命令被拒（`TARGET_VERIFICATION_FAILED`）。
5. **断线语义**：命令执行中断线返回 executionState UNKNOWN，**绝不自动重执行**；连接断开标记 reconnectPending，回合结束后立即补调度；命令超时先 Ctrl+C + 探针复验 shell，验证明白才可继续。
6. **审计**：storageDomain 持久化（timestamp/operation/gateway/target/hostname/command/risk/mode/result/exitCode/duration），无凭据。
7. **并发**：单会话 Mutex，connect/enter/exec/leave/batch 串行；排队中尊重 exec.signal（取消即丢弃）。

## 已知限制

- 仅支持"JumpServer 终端菜单"形态的 SSH 交互资产；无 RDP / VNC / SFTP / 文件传输 / 数据库 / Web Terminal。
- 无 JumpServer REST API / Access Key；无 MFA 自动处理（遇 MFA 会报 AUTH_FAILED/超时）。
- 单 JumpServer 配置、单会话；多会话并行 PTY 仍在规划中，默认串行。
- 终端为"线性镜像"，不完整模拟光标定位/全屏程序（top 等交互界面显示为原始字节流）。
- 命令分类按词法拆分（引号内 `|` 等边界可能误拦，宁可误拦）。

## 故障排查

| 现象 | 处置 |
|---|---|
| JUMPSERVER_NOT_ARMED | 会话未授权：先执行 `/jumpserver <任务>` 或 `/jumpserver on` |
| 侧栏显示 ⚠ 版本不一致 | 重启 dsh web Host 进程，再以 `jumpserver_status` 核对 `pluginVersion / hostBuild` |
| NOT_CONFIGURED | 检查设置页 host/username/密码 |
| DISABLED | 设置页"启用 JumpServer"被关闭 |
| AUTH_FAILED | 用户名/密码错误，或 JumpServer 启用了 MFA/键盘交互 |
| CONNECTION_TIMEOUT | 堡垒机不可达/限速；调大 connectTimeout 或先点"测试连接" |
| MENU_NOT_DETECTED | 菜单文本与内置特征不符：用 smoke 脚本的 screenTail 校准 detector fixture |
| ASSET_VERIFY_FAILED | 目标资产不可登录/探针被禁止；状态 UNKNOWN |
| COMMAND_TIMEOUT | 命令超时；插件先 Ctrl+C 中断并回 shell，再探针复验——验证明白才报告"shell 可用" |
| COMMAND_BLOCKED | READ_ONLY 权限拒绝，或用户拒绝审批 |
| UNKNOWN_STATE | 无法确认位置；已停止执行，请 reconnect/status 后再试 |
| 设置页看不到 JumpServer 卡片 | 确认已构建（lib/client.js 存在）；重启后仍无 → 检查 boot 日志里 client-modules 组合错误 |

## 开发与测试

```bash
npm run typecheck          # host + client 双侧类型检查
npm test                   # vitest（状态机/检测器/分类器/权限闸门/会话/观察者/批量/授权/资产解析/ops 等 260+ 用例）
npm run build              # tsc -> lib/ + esbuild -> lib/client.js
npm run smoke:client       # 浏览器 bundle 物化冒烟
npm run smoke              # 实机冒烟（需 JS_USER + JUMPSERVER_PASSWORD 环境变量，可选 JS_HOST/JS_TARGET_x）
node scripts/plugin-load-smoke.mjs   # 已安装包加载冒烟
node scripts/sync-profile.mjs        # 把 lib/ + package.json 同步进 web profile 安装副本
```

GitHub Actions CI（typecheck + vitest + client bundle smoke）在 main 与 PR 上自动运行 status checks。

## License

MIT
