# cloudflare-notepad 云笔记

[![cloudflare workers](https://badgen.net/badge/a/Cloudflare%20Workers/orange?icon=https%3A%2F%2Fworkers.cloudflare.com%2Fresources%2Flogo%2Flogo.svg&label=)](https://workers.cloudflare.com/)
![example workflow](https://github.com/veegn/cloudflare-notepad/actions/workflows/deploy.yml/badge.svg)
[![jsdelivr](https://img.shields.io/badge/jsdelivr-cdn-brightgreen)](https://www.jsdelivr.com/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/veegn/cloudflare-notepad/blob/master/LICENSE)

[English](./README-en.md) | 简体中文

一个轻量的无服务云笔记项目，支持快速记录、格式化和安全分享。

项目基于 Cloudflare Workers、Workers R2 和 GitHub Actions，易于私有化部署。

`static/js/app.js` 会在本地启动、测试和部署前自动构建，前端源码位于 `frontend/`。

## 功能亮点

- 首页（`/`）展示**文档树**：目录可展开，区分**文章 / 书籍**；书籍分页不在树中列出。
- 全局创建仅 **文章 / 书籍** 两类；**分页**在「编辑书籍」侧栏增删改查。
- 书籍正文为分页目录（TOC）；查看书籍/分页时左侧展示目录。
- 编辑与查看页面均基于 Cloudflare R2 自动保存。
- 支持四种内容模式：纯文本、Markdown、JSON、YAML。
- Markdown 支持分栏实时预览，并可在编辑 / 分栏 / 预览布局间切换。
- 内置格式化能力（按钮 + 快捷键）用于结构化内容。
- 支持浅色 / 深色主题切换，并记住用户偏好。
- 支持笔记密码保护（查看与编辑）。
- 支持私有笔记（`share: false`）与鉴权后的 Raw 原文读取。
- 支持为首页笔记（`_index`）启用独立管理员编辑密码。

## 路由说明

| 路由 | 说明 |
| --- | --- |
| `/` | 文档树首页（文章 + 书籍；含 `_index` 钉住卡） |
| `/new` | 打开创建对话框；`/new?type=article` 仍可随机建文章 |
| `/note/:path` | 查看文档（书籍/分页带左侧 TOC） |
| `/edit/:path` | 编辑文档（书籍带分页管理侧栏） |
| `/api/docs` | 创建文章或书籍（不接受 page） |
| `/api/notes` | 文档列表（可按 `docType` 过滤） |
| `/api/books` · `/api/books/:book/pages` | 书架与分页管理 |
| `/api/home-tree` · `/api/toc?book=` | 首页树 / 书籍目录 |
| `/api/notes/:path?raw=1` | 获取笔记原文（受保护/私有笔记需先鉴权） |
| `/api/auth` | 笔记密码鉴权并设置 HttpOnly Cookie |

## 文档类型与历史数据

| 类型 | `docType` | 创建入口 | 说明 |
| --- | --- | --- | --- |
| 文章 | `article`（缺省） | 全局「新建文档」 | 与旧单篇笔记行为一致 |
| 书籍 | `book` | 全局「新建文档」 | 正文 = 分页目录 Markdown |
| 书籍分页 | `page` | **编辑书籍** 侧栏 | 元数据含 `bookRef`；首页树不展示 |

**历史数据适配（无需强制迁移）：**

- R2 中**没有** `docType` 的对象一律按 **文章** 处理，功能与升级前一致。
- 遗留首页键 `.index` 仍会映射到 `_index`。
- 多段 path（如 `notes/todo`）在首页树中显示为虚拟目录 + 文章，不会破坏旧链接。
- 把某一历史前缀**收编为书籍**（例如 `network_concepts`）：

```bash
# 本地
npm run adopt:book -- network_concepts --title "网络概念"

# 生产（部署完成后，将 BASE_URL 换成你的 Worker 域名）
BASE_URL=https://<your-worker> npm run adopt:book -- network_concepts --title "网络概念"
# 等价于：
# curl -X POST "https://<your-worker>/api/books/network_concepts/adopt?title=%E7%BD%91%E7%BB%9C%E6%A6%82%E5%BF%B5"
```

该接口会：将 `network_concepts` 标记为 `docType=book`，把 `network_concepts/*` 标记为 `docType=page` 并写入 `bookRef`，同时重建书籍正文中的 TOC。

需要把历史路径「升级」为书籍/分页时，优先使用应用内创建与书内分页；也可用本地检查脚本：

```bash
npm run migrate:doctype:dry
```

远程桶上写 `custom_metadata` 需一次性 Worker GET+PUT（与 KV→R2 迁移说明类似）。

## 环境变量

在 Worker 或 GitHub Actions 中建议配置：

```bash
SCN_SALT           # 用于兼容旧密码逻辑的盐
SCN_SECRET         # 必填 JWT 签名密钥（Cloudflare Worker Secret）
SCN_INDEX_PASSWD   # 可选：保护 /.index/edit 的管理员密码
```

## 本地开发

```bash
npm install
copy .dev.vars.example .dev.vars
npm start
```

常用脚本：

- `npm run build:frontend:dev`：构建开发版前端包。
- `npm run build:frontend:prod`：构建生产版前端包。
- `npm run lint`：检查前端 TypeScript 代码规范。
- `npm run typecheck`：执行 TypeScript 类型检查。
- `npm run test:e2e`：运行 Playwright 端到端测试。
- `npm run check`：执行前端检查、Rust 格式/lint/单元测试。
- `npm run migrate:doctype:dry`：检查本地历史笔记的文档类型兼容情况。
- `npm run repair -- <path>`：修复 metadata 与正文不一致（标题/H1、docType、书籍 TOC）。
- `npm run cleanup:e2e -- --force`：清理 e2e 残留对象。

## 部署

### 1. 准备 Cloudflare
1. 前往 [Cloudflare API Token 页面](https://dash.cloudflare.com/profile/api-tokens)，使用 `Edit Cloudflare Workers` 模板创建令牌。
2. 在 Cloudflare 控制台确认/创建 R2 存储桶（正式环境使用 `cloud-notepad-notes`，需与 `wrangler.toml` 中 `bucket_name` 一致）。
3. 在 Cloudflare Worker 控制台，进入你的项目（或先部署一次生成项目），在 `Settings -> Variables` 中添加以下 **Environment Variables**（建议点击 "Encrypt" 设为 Secret）：
   - `SCN_SALT`: 用于加密逻辑的盐（随机字符串）
   - `SCN_SECRET`: JWT 签名密钥（较长的随机字符串）。请配置为 Cloudflare Worker Secret，而不是明文变量。
   - `SCN_INDEX_PASSWD`: (可选) 保护首页编辑的管理员密码

### 2. 配置 GitHub Actions
1. Fork 本仓库。
2. 在 GitHub 仓库的 `Settings -> Secrets and variables -> Actions` 中配置：
   - `CLOUDFLARE_API_TOKEN`: 刚才创建的 Cloudflare API 令牌。

### 3. 执行部署
1. 在 Actions 页面运行 `Deploy cloud-notepad` 工作流。
2. 以后每次推送代码到 `master` 分支也会自动触发部署。

本地部署也可以执行：

```bash
npm install
npm run deploy
```

### 迁移历史 KV 数据到 R2

项目已从 Workers KV 切换到 R2。历史笔记可用迁移脚本导入：

```bash
# 预览（本地 miniflare KV → 本地 miniflare R2，不写入）
npm run migrate:kv-to-r2:dry

# 本地迁移（读 .wrangler/state/v3/kv，写 .wrangler/state/v3/r2）
npm run migrate:kv-to-r2

# 强制覆盖 R2 中已有的同名对象
npm run migrate:kv-to-r2 -- --force

# 只导出转换结果，便于检查
npm run migrate:kv-to-r2 -- --target dump --out .temp/kv-dump

# 远程 KV → 远程 R2（需已登录 wrangler，并创建好 R2 桶）
npm run migrate:kv-to-r2 -- --source remote --target remote \
  --kv-namespace-id <YOUR_KV_NAMESPACE_ID> \
  --r2-bucket cloud-notepad-notes
```

运行时只认 **body 纯内容 + R2 打平后的 custom_metadata**（键：`pw` / `mode` / `updateAt` / `share`，值均为字符串；默认值省略）。迁移脚本在**读取历史 KV 源数据**时仍会识别旧的 `\0META:{json}\0\n{content}` 与过渡期 JSON 信封，写入 R2 时一律打平。`.index` 默认保留原 key；若要把旧首页迁成 `_index`，加 `--rename-legacy-index`。

远程重刷需能写入 custom metadata（`wrangler r2 object put` 不支持）。可使用一次性 Worker：

```bash
wrangler deploy -c wrangler.migrate.toml
curl -X POST https://<migrate-worker>.workers.dev/flush
wrangler delete --name cloudflare-notepad-migrate -c wrangler.migrate.toml --force
```

正式环境已完成：KV `cloud-notepad-NOTES_preview` → R2 桶 `cloud-notepad-notes`，并全量重刷为纯 body + custom metadata（20 条有效笔记）。

## 致谢

- 灵感来自 [s0urcelab/serverless-cloud-notepad](https://github.com/s0urcelab/serverless-cloud-notepad)
- 使用了 [Cloudflare Workers](https://workers.cloudflare.com/)、[itty-router](https://github.com/kwhitley/itty-router)、[CodeMirror](https://codemirror.net/)、[marked](https://github.com/markedjs/marked)、[DOMPurify](https://github.com/cure53/dompurify)、[dayjs](https://github.com/iamkun/dayjs) 和 [js-yaml](https://github.com/nodeca/js-yaml)
