# cloudflare-notepad 云笔记

[![cloudflare workers](https://badgen.net/badge/a/Cloudflare%20Workers/orange?icon=https%3A%2F%2Fworkers.cloudflare.com%2Fresources%2Flogo%2Flogo.svg&label=)](https://workers.cloudflare.com/)
![example workflow](https://github.com/veegn/serverless-cloud-notepad/actions/workflows/deploy.yml/badge.svg)
[![jsdelivr](https://img.shields.io/badge/jsdelivr-cdn-brightgreen)](https://www.jsdelivr.com/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/veegn/serverless-cloud-notepad/blob/master/LICENSE)

[English](./README.md) | 简体中文

一个轻量的无服务云笔记项目，支持快速记录、格式化和安全分享。

项目基于 Cloudflare Workers、Workers KV 和 GitHub Actions，易于私有化部署。

`static/js/app.js` 会在本地启动、测试和部署前自动构建，前端源码位于 `frontend/`。

## 功能亮点

- 首页（`/`）提供欢迎视图与首页笔记预览。
- 支持通过 `/.create` 一键创建随机路径笔记。
- 编辑与查看页面均基于 Cloudflare KV 自动保存。
- 支持四种内容模式：纯文本、Markdown、JSON、YAML。
- Markdown 支持分栏实时预览，并可在编辑 / 分栏 / 预览布局间切换。
- 内置格式化能力（按钮 + 快捷键）用于结构化内容。
- 支持浅色 / 深色主题切换，并记住用户偏好。
- 支持笔记密码保护（查看与编辑）。
- 支持私有笔记（`share: false`）与鉴权后的 Raw 原文读取。
- 支持为首页笔记（`.index`）启用独立管理员编辑密码。

## 路由说明

| 路由 | 说明 |
| --- | --- |
| `/` | 首页笔记（`.index`）仪表盘视图 |
| `/.index/edit` | 编辑首页笔记（可配置管理员密码保护） |
| `/.create` | 生成 5 位随机路径并跳转到编辑页 |
| `/:path` | 查看指定笔记 |
| `/:path/edit` | 编辑指定笔记 |
| `/:path/raw` | 获取笔记原文（受保护/私有笔记需先鉴权） |
| `/:path/edit/auth` | 密码鉴权接口 |
| `/:path/edit/pw` | 设置或移除笔记密码 |
| `/:path/edit/setting` | 更新笔记设置（当前支持 `mode`） |

## 环境变量

在 Worker 或 GitHub Actions 中建议配置：

```bash
SCN_SALT           # 用于兼容旧密码逻辑的盐
SCN_SECRET         # JWT 签名密钥
SCN_INDEX_PASSWD   # 可选：保护 /.index/edit 的管理员密码
```

## 本地开发

```bash
npm install
npm start
```

常用脚本：

- `npm run build:frontend:dev`：构建开发版前端包。
- `npm run build:frontend:prod`：构建生产版前端包。
- `npm run lint`：检查前后端 TypeScript 代码规范。
- `npm run typecheck`：执行 Worker 与前端的类型检查。
- `npm run test:e2e`：运行 Playwright 端到端测试。
- `npm run check`：串行执行 lint + typecheck + e2e。

## 部署

### 1. 准备 Cloudflare
1. 前往 [Cloudflare API Token 页面](https://dash.cloudflare.com/profile/api-tokens)，使用 `Edit Cloudflare Workers` 模板创建令牌。
2. 在 Cloudflare Worker 控制台，进入你的项目（或先部署一次生成项目），在 `Settings -> Variables` 中添加以下 **Environment Variables**（建议点击 "Encrypt" 设为 Secret）：
   - `SCN_SALT`: 用于加密逻辑的盐（随机字符串）
   - `SCN_SECRET`: JWT 签名密钥（较长的随机字符串）
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

## 致谢

- 灵感来自 [s0urcelab/serverless-cloud-notepad](https://github.com/s0urcelab/serverless-cloud-notepad)
- 使用了 [Cloudflare Workers](https://workers.cloudflare.com/)、[itty-router](https://github.com/kwhitley/itty-router)、[CodeMirror](https://codemirror.net/)、[marked](https://github.com/markedjs/marked)、[DOMPurify](https://github.com/cure53/dompurify)、[dayjs](https://github.com/iamkun/dayjs) 和 [js-yaml](https://github.com/nodeca/js-yaml)
