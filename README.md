# ☁ Serverless Cloud Notepad

[![cloudflare workers](https://badgen.net/badge/a/Cloudflare%20Workers/orange?icon=https%3A%2F%2Fworkers.cloudflare.com%2Fresources%2Flogo%2Flogo.svg&label=)](https://workers.cloudflare.com/)
![example workflow](https://github.com/veegn/serverless-cloud-notepad/actions/workflows/deploy.yml/badge.svg)
[![jsdelivr](https://img.shields.io/badge/jsdelivr-cdn-brightgreen)](https://www.jsdelivr.com/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/veegn/serverless-cloud-notepad/blob/master/LICENSE)

English | [简体中文](./README-zh_CN.md)

Build for recording text or sharing between friends.

Powered by Cloudflare Workers、KV & Github Actions, Easy to deploy privately.

## ✨ Features

- ✏ **Modern UI/UX**: Professional "Slate & Blue" design with glassmorphism and smooth animations.
- 🌓 **Theme Support**: Seamless switching between Light and Dark modes with rotating icon effects.
- 📖 **Real-time Preview**: Split-screen (Side-by-Side) live preview with synchronized scrolling for Markdown/JSON/YAML.
- 🔒 **Privacy First**: Password protection for notes with secure JWT-based authentication.
- 💾 **Auto Saving**: Content is saved automatically as you type to Cloudflare KV.
- ⚡ **High Performance**: Powered by Cloudflare Workers for global low-latency access.
- 📦 **Zero Backend**: No traditional server or database required, extremely easy to self-host.

## 🔨 Usage

- Enter `/` root path will generate a new note with a random path.
- Enter `/:path/edit` to edit or set password for a note.
- Enter `/:path` to view a shared note (or login if protected).

Try it out! [https://juu.qzz.io](https://juu.qzz.io)

> [!TIP]
> This project is designed for Cloudflare Workers. Deployment takes less than 2 minutes!

## 💻 Compatibility

- Modern browsers (PC, Tablet & Mobile responsive)

## 📦 Deployment

- Create your Cloudflare API token [here](https://dash.cloudflare.com/profile/api-tokens), choosing the `Edit Cloudflare Workers` template.
- Fork this repository and add 3 Secrets in `Settings -> Secrets and variables -> Actions`:
```bash
CLOUDFLARE_API_TOKEN # your Cloudflare API token
SCN_SALT             # a random string for password hashing
SCN_SECRET           # a secret key for JWT signing
```
- Go to the Actions tab and run the `Deploy cloud-notepad` workflow.

## 👀 Roadmap

- [ ] Support for multiple note themes (Monokai, Solarized, etc.)
- [ ] Export notes as PDF or Image.
- [ ] Collaborative editing support.

