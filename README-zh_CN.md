# ☁ Serverless Cloud Notepad 云笔记（无服务）

[![cloudflare workers](https://badgen.net/badge/a/Cloudflare%20Workers/orange?icon=https%3A%2F%2Fworkers.cloudflare.com%2Fresources%2Flogo%2Flogo.svg&label=)](https://workers.cloudflare.com/)
![example workflow](https://github.com/veegn/serverless-cloud-notepad/actions/workflows/deploy.yml/badge.svg)
[![jsdelivr](https://img.shields.io/badge/jsdelivr-cdn-brightgreen)](https://www.jsdelivr.com/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/veegn/serverless-cloud-notepad/blob/master/LICENSE)

[English](./README.md) | 简体中文

你可以记录文字，与朋友们分享，或者跨设备同步。

基于 Cloudflare Worker、KV 和 Github Actions 实现，一键实现私有化部署。

## ✨ 功能

- ✏ **现代 UI/UX**：基于 "Slate & Blue" 的专业设计，支持玻璃拟态（Glassmorphism）与丝滑动效。
- 🌓 **深色模式**：完美支持亮色/深色主题切换，并配有极具交互感的图标旋转动效。
- 📖 **实时分屏预览**：提供 Markdown/JSON/YAML 的实时分屏预览，并支持左右同步滚动。
- 🔒 **隐私保护**：支持为笔记设置密码，基于安全可靠的 JWT 鉴权机制。
- 💾 **自动保存**：内容随着书写自动保存到 Cloudflare KV，永不丢失。
- ⚡ **全球低延迟**：得益于 Cloudflare Workers，全球各地均能极速访问。
- 📦 **零后端维护**：无需传统数据库或服务器，极易私有化部署。

## 🔨 使用

- 访问根路径 `/` 会自动随机生成一个新的笔记地址。
- 访问 `/:path/edit` 进入编辑模式或设置/修改密码。
- 访问 `/:path` 直接查看分享的笔记（加密笔记需先输入密码）。

现在就试试！ [https://juu.qzz.io](https://juu.qzz.io)

> [!TIP]
> 本项目专为 Cloudflare Workers 设计，一键部署通常耗时不到 2 分钟。

## 💻 兼容性

- 所有现代浏览器 (PC、平板与移动端自适应)

## 📦 私有化部署

- 前往 [这里](https://dash.cloudflare.com/profile/api-tokens) 申请 Cloudflare API 令牌，选择 `编辑 Cloudflare Workers` 模板。
- Fork 本项目，在 `Settings -> Secrets and variables -> Actions` 中添加以下 3 个 Secret:
```bash
CLOUDFLARE_API_TOKEN # 你的 Cloudflare API 令牌
SCN_SALT             # 任意随机字符串（用于密码哈希）
SCN_SECRET           # 任意随机字符串（用于 JWT 签名）
```
- 切换到 Actions 栏，运行 `Deploy cloud-notepad` 工作流。

## 🤝 感谢

- **原项目**：灵感源自于 [s0urcelab/serverless-cloud-notepad](https://github.com/s0urcelab/serverless-cloud-notepad)
- **框架与库**：
  - [Cloudflare Workers](https://workers.cloudflare.com/) - 无服务平台。
  - [itty-router](https://github.com/kwhitley/itty-router) - 极简 Router 框架。
  - [marked](https://github.com/markedjs/marked) - Markdown 解析器。
  - [DOMPurify](https://github.com/cure53/dompurify) - HTML 消毒器（安全过滤）。
  - [dayjs](https://github.com/iamkun/dayjs) - 时间格式化处理。
  - [js-yaml](https://github.com/nodeca/js-yaml) - YAML 解析器。

