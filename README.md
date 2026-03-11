# cloudflare-notepad

[![cloudflare workers](https://badgen.net/badge/a/Cloudflare%20Workers/orange?icon=https%3A%2F%2Fworkers.cloudflare.com%2Fresources%2Flogo%2Flogo.svg&label=)](https://workers.cloudflare.com/)
![example workflow](https://github.com/veegn/serverless-cloud-notepad/actions/workflows/deploy.yml/badge.svg)
[![jsdelivr](https://img.shields.io/badge/jsdelivr-cdn-brightgreen)](https://www.jsdelivr.com/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/veegn/serverless-cloud-notepad/blob/master/LICENSE)

English | [简体中文](./README-zh_CN.md)

A lightweight serverless notepad for quick writing, formatting, and secure sharing.

Built with Cloudflare Workers, Workers KV, and GitHub Actions. Easy to self-host.

The frontend bundle under `static/js/app.js` is generated during local start, tests, and deploy. Source files live in `frontend/`.

## Highlights

- Home dashboard (`/`) with a welcome view and home-note preview.
- One-click random note creation via `/.create`.
- Editing and viewing routes with automatic save to Cloudflare KV.
- Multi-mode writing: plain text, Markdown, JSON, and YAML.
- Markdown split-view editor with live preview and layout switching (Edit / Split / Preview).
- Format tools for structured content (button + keyboard shortcut).
- Light/dark theme toggle with browser preference + local persistence.
- Password protection for note reading and editing.
- Optional private-note mode (`share: false`) and authenticated raw endpoint.
- Optional admin password to protect editing for the home note (`.index`).

## Route overview

| Route | Description |
| --- | --- |
| `/` | Home note (`.index`) dashboard view |
| `/.index/edit` | Edit home note (can be protected by admin password) |
| `/.create` | Generate random 5-char path and redirect to edit page |
| `/:path` | View a note |
| `/:path/edit` | Edit a note |
| `/:path/raw` | Get note raw text (requires auth for protected/private note) |
| `/:path/edit/auth` | Password authentication endpoint |
| `/:path/edit/pw` | Set or remove note password |
| `/:path/edit/setting` | Update note settings (currently supports `mode`) |

## Environment variables

Set these in your Worker/GitHub Actions environment:

```bash
SCN_SALT           # salt used for legacy password compatibility
SCN_SECRET         # JWT signing secret
SCN_INDEX_PASSWD   # optional: protect /.index/edit with admin password
```

## Local development

```bash
npm install
npm start
```

Useful scripts:

- `npm run build:frontend:dev`: development frontend bundle.
- `npm run build:frontend:prod`: production frontend bundle.
- `npm run lint`: lint backend + frontend TypeScript.
- `npm run typecheck`: TypeScript checks for worker and frontend configs.
- `npm run test:e2e`: Playwright E2E tests.
- `npm run check`: lint + typecheck + e2e.

## Deployment

1. Create a Cloudflare API token [here](https://dash.cloudflare.com/profile/api-tokens) using the `Edit Cloudflare Workers` template.
2. Fork this repository and add these GitHub Actions secrets:

```bash
CLOUDFLARE_API_TOKEN
SCN_SALT
SCN_SECRET
```

3. Update `wrangler.toml` with your KV namespace binding if needed.
4. Run the `Deploy cloud-notepad` workflow from the Actions tab.

You can also deploy locally with:

```bash
npm install
npm run deploy
```

## Credits

- Inspired by [s0urcelab/serverless-cloud-notepad](https://github.com/s0urcelab/serverless-cloud-notepad)
- Built with [Cloudflare Workers](https://workers.cloudflare.com/), [itty-router](https://github.com/kwhitley/itty-router), [CodeMirror](https://codemirror.net/), [marked](https://github.com/markedjs/marked), [DOMPurify](https://github.com/cure53/dompurify), [dayjs](https://github.com/iamkun/dayjs), and [js-yaml](https://github.com/nodeca/js-yaml)
