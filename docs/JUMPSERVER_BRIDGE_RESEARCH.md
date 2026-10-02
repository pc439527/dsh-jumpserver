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

## 4. 实现现状

本文件第 1–3 节是 JumpServer / KoKo 的架构参考，结论仍然成立：**KoKo 终端菜单（SSH :2222）是当前唯一必需的接入方式**，Core REST API / BOOTSTRAP_TOKEN 属于可选增强，不应为「列资产」强制引入管理员级凭据。

插件的实际能力、配置项与限制见仓库根目录 [README.md](../README.md)。
