# JumpServer 桥接插件调研与实现规范

> 基线日期：2026-09-01  
> 项目：`dsh-jumpserver`  
> 目标：让 DeepSeek Harness 在公司仅允许通过 JumpServer 的网络条件下，既能安全地由 Agent 自动巡检，也能在右侧 Better Sidebar 中提供可观察、可人工接管的终端。

## 1. 结论先行

JumpServer 确实提供 Core REST API、Terminal/Connector 组件、连接 Token、权限与会话 API；KoKo 则承担 SSH/Telnet/K8s/SFTP/数据库等交互式终端入口。

本项目**不应把 Core API / BOOTSTRAP_TOKEN 变成默认必需条件**：

1. 当前实际可用条件是普通 JumpServer 用户通过 `host:2222` 登录 KoKo；这条路径不需要管理员给服务组件注册权限。
2. `BOOTSTRAP_TOKEN` / Service Account 属于更高权限的部署凭据，应只作为可选增强能力，绝不能为了“列资产”强制引入。
3. 资产发现默认继续走 KoKo 菜单的 `p`（只展示授权资产）并在插件本地筛选；如果未来配置了 Core API Service Account，再把 Core API 作为结构化数据 provider。
4. 命令传输仍由 SSH/PTTY + SessionManager 负责；Core API 不取代当前目标主机 Shell 通道。

因此采用“双通道”架构：

```text
DSH conversation
      │
      ├─ Agent tools ───────────────┐
      │                            │
      ├─ Human sidebar input ──────┤
      │                            ▼
      │                    SessionManager
      │                    (per conversation)
      │                            │
      │                            ▼
      │                     SSH -> KoKo :2222
      │                            │
      │                            ▼
      │                       Target asset
      │
      └─ Optional metadata provider
             ├─ KoKo `p` (default, no admin token)
             └─ Core REST API (optional Service Account)
```

---

## 2. JumpServer 组件与接口体系

### 2.1 核心组件

| 组件 | 主要职责 | 本项目关系 |
|---|---|---|
| Core | Django/DRF，用户、资产、权限、会话、Token 等控制面 | 可选结构化元数据 provider |
| KoKo | Go 终端连接器，SSH/Telnet/K8s/SFTP/DB 等 | **当前主要传输入口** |
| Lion | RDP/VNC 等图形连接 | 当前不需要 |
| Chen / Magnus | 数据库相关连接能力 | 后续按需 |
| Wisp | 终端通信/连接协作组件 | 当前不直接依赖 |

### 2.2 Terminal 组件注册

JumpServer 当前源码中 `TerminalRegistrationApi` 使用 `WithBootstrapToken` 保护。当前 URL 路由同时存在：

```text
/api/v1/terminal/terminal-registrations/
/api/v1/terminal/registration/
```

注意：旧资料中常写成 `/api/v1/terminal/registrations/`，**不要硬编码该旧写法**；应以目标 JumpServer 实例的 Swagger/OpenAPI 为准。

Bootstrap Token 的典型认证方式是请求头：

```http
Authorization: BootstrapToken <BOOTSTRAP_TOKEN>
Content-Type: application/json
```

这类凭据用于组件/服务注册，不等同于普通用户登录密码。

### 2.3 资产 API

常见资产控制面包括：

```text
GET /api/v1/assets/hosts/
GET /api/v1/assets/hosts/{id}/
GET /api/v1/assets/platforms/
GET /api/v1/assets/nodes/
```

具体过滤字段、分页结构及账户字段随 JumpServer 版本变化，应运行时依据该实例 OpenAPI schema 适配，不在插件里假定固定响应结构。

当前项目默认资产发现不依赖这些 API：

```text
KoKo menu -> 输入 p -> 捕获授权资产列表 -> parseAssetList -> 本地 filter
```

这样普通用户无需额外权限，也不会因直接在 KoKo 输入唯一匹配关键字而被自动登录到资产。

### 2.4 会话与 Connection Token

JumpServer 提供终端会话与连接 Token 相关 API。典型用途：

- 创建/校验连接 Token；
- 查询在线会话；
- 获取会话回放；
- Connector 根据 Token 获取目标资产/账号上下文。

这些能力适合未来实现“Core API provider / 会话元数据增强”，但当前 `dsh-jumpserver` 的 SSH/KoKo 模式不需要先生成 Core Connection Token 才能工作。

### 2.5 权限 API

Core 有资产权限与用户授权资产相关接口。未来启用 Core provider 时，必须只返回当前服务账户/用户本身有权查看的资产；不能把管理员级全量资产结果直接暴露给模型。

---

## 3. 认证策略

不同 JumpServer 版本/部署可支持 Session、Token、Access Key、Service Account 等认证形式。实现必须遵循两个原则：

1. **以目标实例 OpenAPI / 管理员提供的认证方式为准**，不要假设“Private Token 永久有效”。Token 有效期、权限和可撤销性受服务端配置控制。
2. 所有敏感值只存 DSH credential store / credential-ref，不进入：
   - 模型上下文；
   - 工具结果；
   - Browser bridge 响应；
   - TerminalObserver；
   - 普通日志。

建议未来 Core provider 配置：

```yaml
coreApi:
  enabled: false
  baseUrl: https://jumpserver.example.com
  organization: <org-uuid>
  authMode: service-account
  credentialRef: JUMPSERVER_CORE_ACCESS_KEY
  tlsVerify: true
```

`enabled=false` 必须保持默认值。

---

## 4. 当前插件必须满足的运行模型

### 4.1 一个 DSH 对话 = 一个 JumpServer 会话

Host 必须使用真实 DSH SessionId：

```ts
exec.agent.session.header.id
```

禁止回退到 `agent.id` 作为生产会话键。每个会话拥有独立：

- `SessionManager`
- SSH/PTTY
- mutex
- reconnect 状态
- currentTarget / hostname / user
- `TerminalObserver`
- Browser terminal cursor / scrollback

切换对话时，旧会话可以继续保留到 idle timeout，但**新对话绝不能继承旧对话当前资产或终端输出**。

### 4.2 Browser bridge 必须按 sessionId 隔离

```text
POST /api/jumpserver.status
POST /api/jumpserver.snapshot
POST /api/jumpserver.manual
```

全部携带当前 Better Sidebar `scope.sessionId`。不存在 bundle 的会话返回独立的 `DISCONNECTED` 视图，不能回退到“最近一个”会话。

### 4.3 Agent 权限与人工权限分开

`READ_ONLY / AUTO / FULL_ACCESS` 是 **Agent 自动工具权限**：

- READ_ONLY：Agent 只允许只读命令；
- AUTO：修改命令要求 DSH approval；
- FULL_ACCESS：普通修改直接执行，高危命令仍 approval。

右侧 Sidebar 的人工输入属于用户明确行为，因此：

- 不走 Agent `gateCommand`；
- 仅在 `ASSET_SHELL` 状态开放；
- 不能直接 `wire.write` 绕过状态机；
- 必须走 `SessionManager.exec`，复用 mutex、marker completion 和目标状态；
- 风险标记 `MANUAL` 并写审计；
- 单次只接受一行输入，拒绝 NUL/CR/LF，限制长度。

这样既能人工接管，又不会把 Agent 的自动权限模型混淆成“整个终端禁止写”。

---

## 5. 终端镜像规范

KoKo/目标 Shell 是真实 PTY，会产生 ANSI/VT100 控制序列。浏览器不能把原始字节直接按行输出。

必须处理：

- SGR 颜色；
- CSI 光标移动、清屏、erase、private mode；
- OSC title（`ESC ] ... BEL/ST`）；
- `\r` 单行覆盖刷新；
- `\b` 回退字符；
- 跨 chunk 的半个 escape；
- connector marker / probe helper；
- shell 对内部 probe 的回显。

用户现场样例：

```text
开始连接 ... 0.0\b\b\b0.1 ... 7.1
ESC]2;ssh://...BEL
[root@host ~]# printf 'H=%s\n' "$(hostname ...)"
[root@host ~]# printf 'U=%s\n' "$(whoami ...)"
[root@host ~]# printf 'P=%s\n' "$(pwd ...)"
```

最终 UI 只应保留有意义内容，例如最终进度、`Last login`、实际命令和服务器 stdout；内部 H/U/P probe 脚本由结构化 target meta 替代。

---

## 6. 资产发现

模型收到：

> 有哪些 OA 服务器？

必须优先：

```text
jumpserver_assets({ filter: "OA" })
```

内部流程：

```text
ensureConnected
  -> 确认 JUMPSERVER_MENU
  -> 输入 p
  -> 捕获授权资产
  -> 解析 name/ip/comment
  -> 本地大小写不敏感筛选 OA
  -> 结构化返回
```

禁止为了找 IP 去搜索 DSH workspace、历史 session log 或猜测资产地址。

如果当前已经处于目标资产 Shell，`jumpserver_assets` 应明确要求先 leave 回菜单，而不是向服务器 Shell 写 `p`。

---

## 7. Core API 可选增强实现

后续可增加统一接口：

```ts
interface AssetProvider {
  listAssets(filter?: string, signal?: AbortSignal): Promise<Asset[]>
}
```

Provider 顺序：

```text
CoreApiAssetProvider（配置并验证成功时）
            ↓ fallback
KokoMenuAssetProvider（默认）
```

Core provider 要求：

1. 启动时只探测 API 版本/schema，不自动注册高权限 Service Account；
2. 只有管理员明确配置 credential-ref 后才启用；
3. 支持 `X-JMS-ORG`；
4. 严格分页；
5. 对响应做 schema validation；
6. 网络/TLS/API 失败自动 fallback 到 KoKo `p`，不影响 SSH 运维通道；
7. 日志永不输出 Authorization / Access Key / Token。

WebSocket 可以作为未来的会话事件增强，但不应成为命令完成判定的唯一来源；当前 marker + PTY 状态机仍是命令执行正确性的基线。

---

## 8. 当前实现状态 / 验收标准

| 项目 | 要求 |
|---|---|
| 对话隔离 | 使用 `agent.session.header.id`；A/B 对话 manager/observer/PTTY 不同 |
| Browser 隔离 | `scope.sessionId` 贯穿 status/snapshot/manual；切换会话清空浏览器 buffer/cursor |
| 资产发现 | `jumpserver_assets(filter?)`，KoKo `p` + 本地筛选 |
| ANSI/VT100 | CSI/OSC/CR/BS/跨 chunk escape 不显示为乱码 |
| Probe 清理 | prompt 前缀的 H/U/P `printf` 及结果行不显示 |
| Follow/Clear | 仅在终端底部 footer 图标区，不占 Better Sidebar 顶部按钮区域 |
| 人工输入 | ASSET_SHELL 可输入；走 SessionManager；不走 Agent gate；风险记为 MANUAL |
| Agent 权限 | READ_ONLY/AUTO/FULL_ACCESS 只控制自动工具 |
| 凭据 | credential-ref，Browser/模型/日志不可读回 |
| Core API | 可选增强；默认关闭，不成为当前 SSH/KoKo 使用前提 |

---

## 9. 部署注意

仓库中的 `src/client/*` 不会被 DSH Web 直接加载。修改后必须重新生成并同步浏览器 bundle：

```bash
npm run typecheck
npm test
npm run build
npm run smoke:client
npm run sync
```

然后完全重启 DSH Desktop 并刷新界面。项目当前 profile 是物理复制目录而不是源码实时引用；如果只更新 Git/source 而没有重新 build + sync，页面仍会继续显示旧版顶部“跟随中/清屏”和旧 ANSI 行为。

---

## 10. 官方验证入口

部署现场以自身 JumpServer 版本为准：

```text
https://<jumpserver>/api/schema/swagger/
https://<jumpserver>/api/schema/redoc/
```

参考源码：

- `jumpserver/jumpserver`：Core / DRF / TerminalRegistrationApi / permissions
- `jumpserver/koko`：SSH 交互菜单、`p` 授权资产列表、终端连接逻辑

本规范优先保证当前公司实际 SSH/KoKo 运维路径稳定；Core API 作为增强控制面逐步接入，而不是反过来让现有可用链路依赖管理员级注册凭据。
