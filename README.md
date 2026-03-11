# Serverless Cloud Notepad

[![cloudflare workers](https://badgen.net/badge/a/Cloudflare%20Workers/orange?icon=https%3A%2F%2Fworkers.cloudflare.com%2Fresources%2Flogo%2Flogo.svg&label=)](https://workers.cloudflare.com/)
![example workflow](https://github.com/veegn/serverless-cloud-notepad/actions/workflows/deploy.yml/badge.svg)
[![jsdelivr](https://img.shields.io/badge/jsdelivr-cdn-brightgreen)](https://www.jsdelivr.com/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/veegn/serverless-cloud-notepad/blob/master/LICENSE)

English | [简体中文](./README-zh_CN.md)

A lightweight serverless notepad for recording text and sharing it across devices or with friends.

Built with Cloudflare Workers, Workers KV, and GitHub Actions. Easy to self-host.

The frontend bundle under `static/js/app.js` is generated during local start, tests, and deploy. Source files live in `frontend/`.

## Features

- Modern UI with light and dark theme support.
- Real-time preview for Markdown, JSON, and YAML.
- Auto-save to Cloudflare KV while typing.
- Password-protected notes for both viewing and editing.
- Raw text endpoint for authenticated reads.
- Zero traditional backend or database management.

## Usage

- Visit `/` to open the homepage note stored at `.index`.
- Visit `/.create` to generate a random note path and jump into edit mode.
- Visit `/:path/edit` to edit a note or set its password.
- Visit `/:path` to view a note. Protected notes require authentication before viewing.

Try it: [https://juu.qzz.io](https://juu.qzz.io)

## Compatibility

- Modern browsers on desktop, tablet, and mobile.

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

If you clone the repo for development, run `npm start`, `npm run test:e2e`, or `npm run build:frontend:prod` before expecting the generated frontend bundle to exist locally.

## Credits

- Inspired by [s0urcelab/serverless-cloud-notepad](https://github.com/s0urcelab/serverless-cloud-notepad)
- Built with [Cloudflare Workers](https://workers.cloudflare.com/), [itty-router](https://github.com/kwhitley/itty-router), [marked](https://github.com/markedjs/marked), [DOMPurify](https://github.com/cure53/dompurify), [dayjs](https://github.com/iamkun/dayjs), and [js-yaml](https://github.com/nodeca/js-yaml)
