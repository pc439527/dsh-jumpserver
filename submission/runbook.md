# dsh-jumpserver → awesome-dsh-plugin 收录提交（按 pc439527/awesome-dsh-plugin fork 的 contributing.md 流程）

## ✅ 已完成（2026-09-02，全部落地）

1. 插件仓库 pc439527/dsh-jumpserver
   - main 已推送 `7afae67`（263c062..7afae67）：根目录 `cordis.patch.yml` + `package.json` 声明 `dsh.bundle`（patch: ./cordis.patch.yml）→ 满足清单 CI 的 dsh.bundle 硬性门槛
   - `dsh-plugin` topic 已设置（API 确认 topics = ["dsh-plugin"]）
   - `dsh plugin add github:pc439527/dsh-jumpserver` 现在可安装
2. 提交分支 pc439527/awesome-dsh-plugin:add-dsh-jumpserver（已推送 e42ff40a）
   - 基点 = upstream main（08bc6bb3），先本地快进同步了 fork main（2495→2938 条目，规避 stale-fork guard）
   - 内容：`data/plugins/pc439527__dsh-jumpserver.yml`（category: remote，中英单行描述）+ 重新生成的 README.md / README.zh.md（各 +1 行）；共 3 文件 +8 行
   - 本地校验全过：validateEntries 0 问题；generate-readme.mjs --check OK
   - GitHub 已提示可直接开 PR：https://github.com/pc439527/awesome-dsh-plugin/pull/new/add-dsh-jumpserver

## ⏳ 待办：等门禁达标后开 PR

Submission gate 自动检查（每 PR 依次）：
- ✔ dsh.bundle
- ✘ 仓库年龄 ≥1 天：created_at = 2026-09-02T08:18:23Z → 最早 **2026-09-03 08:18Z（UTC+8 16:18）** 起达标
- ✘ 默认分支提交数 ≥10：目前 2 → 继续正常开发累积真实提交（resubmit 无负面影响，contributing 明确欢迎）
- ✔ 条目数（≤3）、YAML 合法性、README 可再生成

达标后（两步均可由你手动，或让模型代做）：

```bash
# 1. 开 PR（gh 需已登录：gh auth login）
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --head pc439527:add-dsh-jumpserver --base main \
  --title "add pc439527/dsh-jumpserver (remote)" \
  --body-file submission/pr-body-dsh-jumpserver.md

# 2. 若 PR 被打回要求改描述：改 submission/pc439527__dsh-jumpserver.yml
#    在 fork 工作副本重新 generate 并 push 同一分支即可，无需重开 PR
```

可选（推荐，contributing.md 的安装体验建议）：
- 发布 npm 包 `npm publish`：预构建安装免 allowBuilds 授权；包内 `repository` 字段须指回 pc439527/dsh-jumpserver（映射自动关联）
- 给 GitHub Release 附预构建 tarball 并用条目的可选 `tarball:` 字段指向
- GitHub 网页上点 fork 的 `Sync fork`（把 fork main 同步到 upstream；非必须，分支已基于 upstream main）

## 本地产物（工作区 submission/，未跟踪、不入库）

- add-dsh-jumpserver.bundle — 分支备份（11 MB），可 `git fetch <bundle> add-dsh-jumpserver:add-dsh-jumpserver` 恢复
- pc439527__dsh-jumpserver.yml — 条目文件副本
- pr-body-dsh-jumpserver.md — PR 文案
