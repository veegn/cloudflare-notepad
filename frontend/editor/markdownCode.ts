import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import typescript from 'highlight.js/lib/languages/typescript'
import yaml from 'highlight.js/lib/languages/yaml'
import { getI18n } from '../core/config'
import { showToast } from '../core/ui'

for (const [name, grammar] of Object.entries({ bash, javascript, json, python, rust, typescript, yaml })) {
    hljs.registerLanguage(name, grammar)
}

export function enhanceMarkdownCode(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('pre > code').forEach(code => {
        const pre = code.parentElement!
        const source = code.textContent ?? ''
        const declared = Array.from(code.classList).find(name => name.startsWith('language-'))?.slice(9)
        const language = declared?.toLowerCase()
        const grammar = language ? hljs.getLanguage(language) : undefined
        if (grammar && language) {
            // The highlighter escapes the source and emits token spans.
            code.innerHTML = hljs.highlight(source, { language, ignoreIllegals: true }).value
        }

        const block = document.createElement('div')
        block.className = 'md-code-block'
        const toolbar = document.createElement('div')
        toolbar.className = 'md-code-toolbar'
        const label = document.createElement('span')
        label.textContent = grammar?.name || declared || getI18n('markdownPlainText')

        const copy = document.createElement('button')
        copy.type = 'button'
        copy.className = 'md-code-copy'
        const copyLabel = getI18n('markdownCopyCode')
        copy.textContent = copyLabel
        copy.setAttribute('aria-live', 'polite')
        let reset = 0
        copy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(source)
                window.clearTimeout(reset)
                copy.textContent = getI18n('copied')
                reset = window.setTimeout(() => { copy.textContent = copyLabel }, 1600)
            } catch {
                const selection = window.getSelection()
                const range = document.createRange()
                range.selectNodeContents(code)
                selection?.removeAllRanges()
                selection?.addRange(range)
                showToast(getI18n('copyRawManual'))
            }
        })

        toolbar.append(label, copy)
        pre.before(block)
        block.append(toolbar, pre)
    })
}
