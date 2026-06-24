# cloudflare-notepad

[![cloudflare workers](https://badgen.net/badge/a/Cloudflare%20Workers/orange?icon=https%3A%2F%2Fworkers.cloudflare.com%2Fresources%2Flogo%2Flogo.svg&label=)](https://workers.cloudflare.com/)
![example workflow](https://github.com/veegn/cloudflare-notepad/actions/workflows/deploy.yml/badge.svg)
[![jsdelivr](https://img.shields.io/badge/jsdelivr-cdn-brightgreen)](https://www.jsdelivr.com/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/veegn/cloudflare-notepad/blob/master/LICENSE)

English | [简体中文](./README.md)

A lightweight serverless notepad for quick writing, formatting, and secure sharing.

Built with Cloudflare Workers, Workers KV, and GitHub Actions. Easy to self-host.

The frontend bundle under `static/js/app.js` is generated during local start, tests, and deploy. Source files live in `frontend/`.

## Highlights

- Home dashboard (`/`) with a welcome view and home-note preview.
- One-click random note creation via `/new`.
- Editing and viewing routes with automatic save to Cloudflare KV.
- Multi-mode writing: plain text, Markdown, JSON, and YAML.
- Markdown split-view editor with live preview and layout switching (Edit / Split / Preview).
- Format tools for structured content (button + keyboard shortcut).
- Light/dark theme toggle with browser preference + local persistence.
- Password protection for note reading and editing.
- Optional private-note mode (`share: false`) and authenticated raw endpoint.
- Optional admin password to protect editing for the home note (`_index`).

## Route overview

| Route | Description |
| --- | --- |
| `/` | Home note (`.index`) dashboard view |
| `/` | Home note (`_index`) dashboard |
| `/new` | Create a note and redirect to its editor |
| `/note/:path` | View a note |
| `/edit/:path` | Edit a note |
| `/api/notes/:path?raw=1` | Get raw note text (requires auth for protected/private notes) |
| `/api/auth` | Authenticate a note password and set an HttpOnly cookie |

## Environment variables

Set these in your Worker/GitHub Actions environment:

```bash
SCN_SALT           # salt used for legacy password compatibility
SCN_SECRET         # required JWT signing secret (Cloudflare Worker Secret)
SCN_INDEX_PASSWD   # optional: protect /.index/edit with admin password
```

## Local development

```bash
npm install
copy .dev.vars.example .dev.vars
npm start
```

Useful scripts:

- `npm run build:frontend:dev`: development frontend bundle.
- `npm run build:frontend:prod`: production frontend bundle.
- `npm run lint`: lint frontend TypeScript.
- `npm run typecheck`: TypeScript checks.
- `npm run test:e2e`: Playwright E2E tests.
- `npm run check`: frontend checks, Rust format/lint/unit tests.

## Deployment

### 1. Prepare Cloudflare
1. Create a Cloudflare API token [here](https://dash.cloudflare.com/profile/api-tokens) using the `Edit Cloudflare Workers` template.
2. In your Cloudflare Worker dashboard, go to `Settings -> Variables` and add the following **Environment Variables** (recommend using "Encrypt" for secrets):
   - `SCN_SALT`: A random string used for password hashing compatibility.
   - `SCN_SECRET`: A long random string for JWT signing. Configure it as a Cloudflare Worker Secret, not a plaintext variable.
   - `SCN_INDEX_PASSWD`: (Optional) Admin password to protect home note editing.

### 2. Configure GitHub Actions
1. Fork this repository.
2. In your repository `Settings -> Secrets and variables -> Actions`, add:
   - `CLOUDFLARE_API_TOKEN`: The token you just created.

### 3. Run Deployment
1. Go to the **Actions** tab and run the `Deploy cloud-notepad` workflow.
2. Future pushes to the `master` branch will trigger deployment automatically.

You can also deploy locally with:

```bash
npm install
npm run deploy
```

## Credits

- Inspired by [s0urcelab/serverless-cloud-notepad](https://github.com/s0urcelab/serverless-cloud-notepad)
- Built with [Cloudflare Workers](https://workers.cloudflare.com/), [itty-router](https://github.com/kwhitley/itty-router), [CodeMirror](https://codemirror.net/), [marked](https://github.com/markedjs/marked), [DOMPurify](https://github.com/cure53/dompurify), [dayjs](https://github.com/iamkun/dayjs), and [js-yaml](https://github.com/nodeca/js-yaml)
