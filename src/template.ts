import { SUPPORTED_LANG } from './constant'
import type { LanguageCode, NoteMetadata, TemplateData } from './types'

function escapeHtml(value = ''): string {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

function safeJSONStringify(data: unknown): string {
    return JSON.stringify(data).replaceAll('<', '\\u003c')
}

const LOADING = (): string => `
<div id="loading" class="status-indicator" style="opacity: 0;"></div>
`

const TITLEBAR = ({ title, isEdit }: Pick<TemplateData, 'title' | 'isEdit'>): string => `
<header class="titlebar">
  <div class="titlebar-left">
    <div class="traffic-lights" aria-hidden="true">
      <span class="traffic-light close"></span>
      <span class="traffic-light minimize"></span>
      <span class="traffic-light maximize"></span>
    </div>
    <div class="product-name">Cloud Notepad</div>
  </div>
  <div class="titlebar-center">${escapeHtml(title)}${isEdit ? '.md' : ''}</div>
  <div class="titlebar-right">
    <div class="window-actions">
      <span></span>
      <span></span>
      <span></span>
    </div>
  </div>
</header>
`

const TABBAR = ({ title, isEdit, isHome }: Pick<TemplateData, 'title' | 'isEdit' | 'isHome'>): string => `
<div class="editor-tabbar">
  <div class="editor-tab active">
    <span class="editor-tab-icon">${isHome ? '*' : isEdit ? '</>' : '#'}</span>
    <span class="editor-tab-label">${escapeHtml(title || 'untitled')}</span>
  </div>
  <div class="editor-tab-actions"></div>
</div>
`

const WELCOME = ({ content }: Pick<TemplateData, 'content'>): string => `
<div class="welcome-view">
  <div class="welcome-hero">
    <div class="welcome-kicker">Cloud Notepad</div>
    <h1 class="welcome-title">A lightweight workspace for quick notes and secure sharing.</h1>
    <p class="welcome-copy">Keep the interface simple, create notes quickly, and use one focused editor when you need to write, preview, or share.</p>
    <div class="welcome-actions">
      <a class="welcome-button primary" href="/.create">New Note</a>
      <a class="welcome-button" href="/.index/edit">Edit Home</a>
    </div>
  </div>
  <div class="welcome-grid">
    <section class="welcome-card">
      <div class="welcome-card-title">Quick Start</div>
      <ul class="welcome-list">
        <li>Create a note from a random path.</li>
        <li>Edit in one merged writing surface.</li>
        <li>Protect the note when private reading matters.</li>
      </ul>
    </section>
    <section class="welcome-card">
      <div class="welcome-card-title">Home Note Preview</div>
      <div id="preview-home" class="welcome-note-preview">${escapeHtml(content || 'No content yet. Use "Edit Home" to add your own dashboard notes.')}</div>
    </section>
  </div>
</div>
`

const COMPOSER = ({
    lang,
    content,
    isEdit,
    mode,
}: {
    lang: LanguageCode
    content?: string
    isEdit?: boolean
    mode?: NoteMetadata['mode']
}): string => `
<div class="composer-frame ${isEdit ? 'is-editing' : 'is-reading'} mode-${escapeHtml(mode || 'plain')}" data-mode="${escapeHtml(mode || 'plain')}">
  ${
    isEdit && mode !== 'md'
        ? `
  <div
    id="cm-editor"
    class="cm-editor-host"
    data-placeholder="${escapeHtml(SUPPORTED_LANG[lang].emptyPH)}"
  >${escapeHtml(content || '')}</div>
  `
        : isEdit
            ? `
  <div class="composer-split-pane">
    <div class="composer-editor-pane">
      <div
        id="cm-editor"
        class="cm-editor-host"
        data-placeholder="${escapeHtml(SUPPORTED_LANG[lang].emptyPH)}"
      >${escapeHtml(content || '')}</div>
    </div>
    <div class="composer-preview-pane">
      <div class="composer-preview-scroll" id="preview-scroll">
        <div id="preview" class="composer-preview" aria-hidden="false"></div>
      </div>
    </div>
  </div>
  `
            : `
  <div class="composer-main">
    <div class="composer-preview-scroll" id="preview-scroll">
      <div id="preview" class="composer-preview" aria-hidden="false"></div>
    </div>
  </div>
  `
  }
</div>
`

const EDITOR_BODY = ({
    tips,
    content,
    ext = {},
    isEdit,
    lang,
    isHome,
}: TemplateData): string => `
<div class="editor-body">
  ${tips ? `<div class="editor-banner">${escapeHtml(tips)}</div>` : ''}
  ${isHome ? WELCOME({ content }) : COMPOSER({ lang, content, isEdit, mode: ext.mode || 'plain' })}
</div>
`

const WORKBENCH = ({ lang, title, content, ext = {}, tips, isEdit, isHome }: TemplateData): string => `
<main class="workbench">
  <section class="editor-pane">
    ${TABBAR({ title, isEdit, isHome })}
    ${EDITOR_BODY({ lang, title, content, ext, tips, isEdit, isHome })}
  </section>
</main>
`

const STATUSBAR = ({ isEdit, isHome }: Pick<TemplateData, 'isEdit' | 'isHome'>): string => `
<footer class="statusbar">
  <div class="statusbar-left">
    <div id="footer-actions" class="status-actions ${isEdit ? '' : 'view-actions'}"></div>
  </div>
  <div class="statusbar-right">
    ${isEdit && !isHome ? `
    <button class="opt-button opt-format" id="format-trigger" type="button">Format Now</button>
    <div class="mode-picker" id="mode-picker">
      <button class="opt-button mode-picker-trigger" id="mode-trigger" type="button">Format</button>
      <div class="mode-picker-menu hide" id="mode-menu"></div>
    </div>
    ` : ''}
    ${LOADING()}
    <div id="last-modified-container"></div>
    <div id="github-link-container"></div>
  </div>
</footer>
`

const SCRIPTS = ({ showPwPrompt, config }: { showPwPrompt?: boolean; config: Record<string, unknown> }): string => `
<script>
  window.CONFIG = ${safeJSONStringify(config)};
</script>
<script type="module">
  import { initApp, passwdPrompt } from '/js/app.js'
  initApp()
  ${showPwPrompt ? 'passwdPrompt()' : ''}
</script>
`

const HEAD = ({ title }: Pick<TemplateData, 'title'>): string => `
<head>
  <meta charset="utf-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} - Cloud Notepad</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link href="/favicon.ico" rel="shortcut icon" type="image/ico" />
  <link href="/css/app.css" rel="stylesheet" media="screen" />
</head>
`

const HTML = ({
    lang,
    title,
    content,
    ext = {},
    tips,
    isEdit,
    showPwPrompt,
    isHome,
}: TemplateData): string => {
    const config = {
        lang,
        isEdit,
        isHome,
        updateAt: ext.updateAt,
        pw: Boolean(ext.pw),
        mode: ext.mode || 'plain',
        content,
        i18n: SUPPORTED_LANG,
    }

    return `
<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
${HEAD({ title })}
<body>
  <div class="app-shell">
    ${TITLEBAR({ title, isEdit })}
    ${WORKBENCH({ lang, title, content, ext, tips, isEdit, isHome })}
    ${STATUSBAR({ isEdit, isHome })}
  </div>
  ${SCRIPTS({ showPwPrompt, config })}
</body>
</html>
`
}

export const Home = (data: TemplateData): string => HTML({ isHome: true, ...data })
export const Edit = (data: TemplateData): string => HTML({ isEdit: true, ...data })
export const Share = (data: TemplateData): string => HTML(data)
export const NeedPasswd = (data: TemplateData): string => HTML({
    tips: SUPPORTED_LANG[data.lang][data.tipKey || 'tipEncrypt'],
    showPwPrompt: data.showPwPrompt !== false,
    ...data,
})
export const Page404 = (data: TemplateData): string => HTML({ tips: SUPPORTED_LANG[data.lang].tip404, ...data })
