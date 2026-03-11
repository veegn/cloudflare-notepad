# Serverless Cloud Notepad 云笔记

[![cloudflare workers](https://badgen.net/badge/a/Cloudflare%20Workers/orange?icon=https%3A%2F%2Fworkers.cloudflare.com%2Fresources%2Flogo%2Flogo.svg&label=)](https://workers.cloudflare.com/)
![example workflow](https://github.com/veegn/serverless-cloud-notepad/actions/workflows/deploy.yml/badge.svg)
[![jsdelivr](https://img.shields.io/badge/jsdelivr-cdn-brightgreen)](https://www.jsdelivr.com/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/veegn/serverless-cloud-notepad/blob/master/LICENSE)

[English](./README.md) | 简体中文

一个轻量的无服务云笔记项目，适合记录文本，并在多设备之间或与朋友共享。

项目基于 Cloudflare Workers、Workers KV 和 GitHub Actions，易于私有化部署。

## 功能

- 现代化界面，支持浅色和深色主题。
- 支持 Markdown、JSON、YAML 实时预览。
- 输入时自动保存到 Cloudflare KV。
- 支持为笔记设置密码，并同时保护查看和编辑。
- 支持基于认证的 Raw 原文读取。
- 无需传统后端和数据库运维。

## 使用方式

- 访问 `/` 可打开存储在 `.index` 中的首页笔记。
- 访问 `/.create` 会生成一个随机路径，并直接进入编辑页。
- 访问 `/:path/edit` 可编辑笔记或设置密码。
- 访问 `/:path` 可查看笔记；受保护笔记需要先完成认证。

在线示例：[https://juu.qzz.io](https://juu.qzz.io)

## 兼容性

- 支持现代桌面、平板和移动端浏览器。

## 部署

1. 前往 [Cloudflare API Token 页面](https://dash.cloudflare.com/profile/api-tokens)，使用 `Edit Cloudflare Workers` 模板创建令牌。
2. Fork 本仓库后，在 GitHub Actions Secrets 中配置：

```bash
CLOUDFLARE_API_TOKEN
SCN_SALT
SCN_SECRET
```

3. 视情况更新 `wrangler.toml` 中的 KV 绑定配置。
4. 在 Actions 页面运行 `Deploy cloud-notepad` 工作流。

本地部署也可以直接执行：

```bash
npm install
npm run deploy
```

## 致谢

- 灵感来自 [s0urcelab/serverless-cloud-notepad](https://github.com/s0urcelab/serverless-cloud-notepad)
- 使用了 [Cloudflare Workers](https://workers.cloudflare.com/)、[itty-router](https://github.com/kwhitley/itty-router)、[marked](https://github.com/markedjs/marked)、[DOMPurify](https://github.com/cure53/dompurify)、[dayjs](https://github.com/iamkun/dayjs) 和 [js-yaml](https://github.com/nodeca/js-yaml)
