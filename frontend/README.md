# Frontend layout

```text
frontend/
  app.ts                 # esbuild entry (static/js/app.js)
  core/                  # shared primitives
    config.ts            # window.CONFIG + i18n helpers
    types.ts
    ui.ts                # modal/toast/theme
    pathUtils.ts         # encodeNotePath / escapeHtml / DOM helpers
    globals.d.ts
  editor/                # note editing surfaces
    editor.ts            # CodeMirror
    renderers.ts         # markdown/json/yaml preview
    formatters.ts
  features/              # product surfaces
    homeTree.ts          # homepage document tree
    bookSidebar.ts       # book TOC / page manager
    createDoc.ts         # article|book create dialog
    repair.ts            # metadata repair API client
```

Import rule: same-folder modules use `./x`; `core`/`editor`/`features` cross-import via `../core/...` etc.
