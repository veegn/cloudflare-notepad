import { SUPPORTED_LANG } from './constant'

// Loading indicator component (placeholder for client-side)
const LOADING = () => `
<div id="loading" style="opacity: 0;"></div>
`

// Theme toggle button container
const THEME_TOGGLE = () => `
<div class="theme-toggle-container"></div>
`

// Footer component shell
const FOOTER = ({ isEdit }) => `
<div class="footer">
  <div id="footer-actions" class="opt ${isEdit ? '' : 'opt-view'}"></div>
  <div class="metadata">
    ${LOADING()}
    <div id="last-modified-container"></div>
    <div id="github-link-container"></div>
  </div>
</div>
`

// Tips component
const TIPS = ({ tips }) => `
<div class="tips">${tips}</div>
`

// Textarea component
const TEXTAREA = ({ lang, content, isEdit }) => `
<textarea id="contents" class="contents ${isEdit ? '' : 'hide'}" spellcheck="true" placeholder="${SUPPORTED_LANG[lang].emptyPH}">${content}</textarea>
`

// Divider line component
const DIVIDE_LINE = () => `
<div class="divide-line"></div>
`

// Preview component
const PREVIEW = ({ ext, isEdit, tips }) => {
  if (tips || (isEdit && !['md', 'json', 'yaml'].includes(ext.mode))) {
    return ''
  }
  return `<div id="preview-${ext.mode || 'plain'}" class="contents" tabindex="-1" contenteditable="false"></div>`
}

// Note container component
const NOTE_CONTAINER = ({ tips, content, ext = {}, isEdit, lang }) => `
<div class="note-container">
  <div class="stack">
    <div class="layer">
      ${tips ? TIPS({ tips }) : ''}
      ${TEXTAREA({ lang, content, isEdit })}
      ${(isEdit && ['md', 'json', 'yaml'].includes(ext.mode)) ? DIVIDE_LINE() : ''}
      ${PREVIEW({ ext, isEdit, tips })}
    </div>
  </div>
</div>
`

// Script components
const SCRIPTS = ({ showPwPrompt, config }) => `
<script>
  window.CONFIG = ${JSON.stringify(config)};
</script>
<script src="/js/purify.min.js"></script>
<script src="/js/marked.min.js"></script>
<script src="/js/js-yaml.min.js"></script>
<script src="/js/dayjs.min.js"></script>
<script src="/js/relativeTime.min.js"></script>
<script src="/js/clip.js"></script>
<script src="/js/app.js"></script>
${showPwPrompt ? '<script>passwdPrompt()</script>' : ''}
`

// HTML head component
const HEAD = ({ lang, title }) => `
<head>
  <meta charset="utf-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title} — Cloud Notepad</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link href="/favicon.ico" rel="shortcut icon" type="image/ico" />
  <link href="/css/app.css" rel="stylesheet" media="screen" />
</head>
`

// Main HTML template
const HTML = ({ lang, title, content, ext = {}, tips, isEdit, showPwPrompt }) => {
  const config = {
    lang,
    isEdit,
    updateAt: ext.updateAt,
    pw: !!ext.pw,
    mode: ext.mode,
    i18n: SUPPORTED_LANG
  }

  return `
<!DOCTYPE html>
<html lang="${lang}">
${HEAD({ lang, title })}
<body>
  ${NOTE_CONTAINER({ tips, content, ext, isEdit, lang })}
  ${FOOTER({ isEdit })}
  ${SCRIPTS({ showPwPrompt, config })}
</body>
</html>
`
}

export const Edit = data => HTML({ isEdit: true, ...data })
export const Share = data => HTML(data)
export const NeedPasswd = data => HTML({ tips: SUPPORTED_LANG[data.lang].tipEncrypt, showPwPrompt: true, ...data })
export const Page404 = data => HTML({ tips: SUPPORTED_LANG[data.lang].tip404, ...data })
