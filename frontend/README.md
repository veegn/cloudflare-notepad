# Frontend layout

```text
frontend/
  app.ts                 # esbuild entry (static/js/app.js)
  core/                  # shared primitives
    config.ts            # window.CONFIG + i18n helpers
    types.ts
    api.ts               # JSON API transport
    modal.ts             # dialog lifecycle and dismissal
    viewport.ts          # viewport queries used by UI logic
    ui.ts                # prompts, toast and theme
    pathUtils.ts         # encodeNotePath / DOM lookup helpers
    html.ts              # shared HTML escaping
    globals.d.ts
  styles/                # esbuild CSS entry and styles by surface
  editor/                # note editing surfaces
    editor.ts            # CodeMirror
    renderers.ts         # preview entry and plain-source fallback
    markdownPreview.ts   # Markdown, assets and Mermaid fallback
    codePreview.ts       # plain / JSON / YAML rendering
    highlighting.ts      # shared keyword highlighting
    formatters.ts
  features/              # product surfaces
    homeTree.ts          # homepage document tree
    bookSidebar.ts       # book TOC / page manager
    modePicker.ts        # editor format selector and mode updates
    createDoc.ts         # article|book create dialog
    repair.ts            # metadata repair API client
    readingControls.ts   # mobile reading-mode status bar toggle
```

Import rule: same-folder modules use `./x`; `core`/`editor`/`features` cross-import via `../core/...` etc.

`npm run build:frontend` bundles `styles/app.css` to `static/css/app.css`. Edit the source styles under `styles/`. The width breakpoints are 720px for mobile layouts, 760px for the compact status bar, and 860px for workbench padding. Keep the media queries in `styles/responsive.css` aligned with `core/viewport.ts`.
