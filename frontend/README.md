# Frontend layout

```text
frontend/
  app.ts                 # esbuild entry (static/js/app.js)
  core/                  # shared primitives
    config.ts            # window.CONFIG + i18n helpers
    types.ts
    ui.ts                # modal/toast/theme
    pathUtils.ts         # encodeNotePath / DOM lookup helpers
    html.ts              # shared HTML escaping
    globals.d.ts
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
```

Import rule: same-folder modules use `./x`; `core`/`editor`/`features` cross-import via `../core/...` etc.
