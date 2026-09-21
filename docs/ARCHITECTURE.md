# 架构与目录结构

Cloudflare Notepad：Workers（Rust/WASM）+ R2 + 服务端模板 + TypeScript 前端。

## 顶层目录

```text
src/                 Worker（Rust）
  models/            数据结构（NoteMetadata、DTO）
  services/          领域逻辑（鉴权、笔记存储）
  routes/            HTTP 路由（页面 + API）
  i18n/              中英文案
frontend/            浏览器 TS（esbuild 打成 static/js/app.js）
  core/              配置、类型、UI 基元、路径工具
  editor/            CodeMirror 编辑器、预览、格式化
  features/          首页树、书籍侧栏、创建对话框、repair
  app.ts             前端入口
templates/           Tera HTML（base / home / edit / share）
static/              静态资源（css、js、图标）
tests/               Playwright e2e
scripts/             运维与构建脚本
docs/                产品与架构文档
```

## 数据模型（R2）

| 项 | 说明 |
| --- | --- |
| 对象 key | 文档 path，如 `handbook`、`handbook/install` |
| body | Markdown 等正文；**书籍的 TOC 也在 body 里** |
| custom_metadata | `docType` / `bookRef` / `title` / `pw` / `mode` / `updateAt` / `share` |
| 图片资产 | 与文档**同级**：`{note}.assets/{id}-{name}`（如 `handbook/install.assets/a.png`）；Markdown 写相对路径 `./install.assets/a.png` |
| 派生缓存 | `_meta/home-tree.json`、`_meta/toc/<book>.json` |

**文档类型**

- `article`：单篇（缺省；兼容无 metadata 的历史对象）
- `book`：书籍；正文为分页目录
- `page`：书籍分页；`bookRef` 指向所属书；**不在首页树中列出**

**创建**：全局仅「文章 / 书籍」；分页在 `/edit/{book}` 侧栏创建。

## 关键请求路径

| 路径 | 职责 |
| --- | --- |
| `GET /` | 首页文档树 |
| `GET /note/*` · `GET /edit/*` | 查看 / 编辑；书与分页带左侧目录 |
| `POST /api/docs` | 创建文章或书籍 |
| `GET /api/home-tree` | 首页树（可 `?refresh=1`） |
| `GET /api/toc?book=` | 书籍目录（解析 body TOC） |
| `GET/POST /api/books/:book/pages` | 分页列表 / 新建 |
| `POST /api/books/:book/adopt` | 历史路径收编为书 |
| `POST /api/repair` | **以正文为基准**修复 metadata（`prefer=h1` 默认） |
| `GET /api/notes` · `GET /api/books` | 列表 |
| `POST /api/auth` | 密码笔记 JWT Cookie |

## 同步与修复

- 正文与 metadata 可能冗余（加速列表）。
- 日常写入走 `services/note` 统一 API，并失效 `_meta/*` 缓存。
- 不一致时用 **修复数据**（UI 或 `npm run repair`）：以 Markdown H1 / 书籍 TOC 为准回写 metadata。

## 构建与测试

| 命令 | 作用 |
| --- | --- |
| `npm run build:frontend:dev/prod` | 前端打包 → `static/js/app.js` |
| `npm run check` | lint + typecheck + cargo fmt/clippy/test |
| `npm run test:e2e` | Playwright（默认端口 8799，可用 `E2E_PORT`） |
| `npm start` | `wrangler dev` |

部署：push `master` → GitHub Actions `deploy.yml`。

## 文档

- 产品方案与 UI：见 `docs/README.md`
- 历史路径收编：`POST /api/books/:path/adopt` 或 `npm run adopt:book`
- 清理 e2e 残留：`npm run cleanup:e2e`
