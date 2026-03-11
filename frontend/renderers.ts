import { KEYWORD_PATTERN } from './config'
import type { Mode } from './types'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export function escapeHtml(text = ''): string {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

export function escapeCodeHtml(text = ''): string {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
}

export function wrapKeywords(text: string): string {
    return text.replace(KEYWORD_PATTERN, '<mark class="keyword-highlight">$1</mark>')
}

export function renderMarkdownFocusOverlay(text: string): string {
    const lines = text.split('\n')
    const html = lines.map(line => {
        const escapedLine = wrapKeywords(escapeCodeHtml(line))
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
        if (headingMatch) {
            const level = headingMatch[1].length
            return `
                <div class="md-overlay-line md-overlay-heading md-overlay-heading-${level}">
                    <span class="md-overlay-marker">${escapeCodeHtml(headingMatch[1])}</span>
                    <span class="md-overlay-text">${wrapKeywords(escapeCodeHtml(headingMatch[2]))}</span>
                </div>
            `
        }

        const taskMatch = line.match(/^(\s*[-*+]\s+\[[ xX]\])\s+(.*)$/)
        if (taskMatch) {
            return `
                <div class="md-overlay-line md-overlay-task">
                    <span class="md-overlay-marker">${escapeCodeHtml(taskMatch[1])}</span>
                    <span class="md-overlay-text">${wrapKeywords(escapeCodeHtml(taskMatch[2]))}</span>
                </div>
            `
        }

        const quoteMatch = line.match(/^(\s*>+\s?)(.*)$/)
        if (quoteMatch) {
            return `
                <div class="md-overlay-line md-overlay-quote">
                    <span class="md-overlay-marker">${escapeCodeHtml(quoteMatch[1].trimEnd())}</span>
                    <span class="md-overlay-text">${wrapKeywords(escapeCodeHtml(quoteMatch[2]))}</span>
                </div>
            `
        }

        const listMatch = line.match(/^(\s*(?:[-*+]|\d+\.))\s+(.*)$/)
        if (listMatch) {
            return `
                <div class="md-overlay-line md-overlay-list">
                    <span class="md-overlay-marker">${escapeCodeHtml(listMatch[1].trim())}</span>
                    <span class="md-overlay-text">${wrapKeywords(escapeCodeHtml(listMatch[2]))}</span>
                </div>
            `
        }

        if (!line.trim()) {
            return '<div class="md-overlay-line md-overlay-empty"><span class="md-overlay-text">&nbsp;</span></div>'
        }

        return `<div class="md-overlay-line"><span class="md-overlay-text">${escapedLine}</span></div>`
    }).join('')

    return `<div class="md-overlay-block">${html}</div>`
}

type Replacement = {
    pattern: RegExp
    render: (...args: string[]) => string
}

function applyTokenReplacements(source: string, replacements: Replacement[]): string {
    const tokens: string[] = []
    const markers: string[] = []
    let output = source

    const encodeIndex = (value: number): string => {
        let current = value + 1
        let result = ''

        while (current > 0) {
            current -= 1
            result = String.fromCharCode(65 + (current % 26)) + result
            current = Math.floor(current / 26)
        }

        return result
    }

    replacements.forEach(({ pattern, render }) => {
        output = output.replace(pattern, (...args) => {
            const html = render(...(args as string[]))
            const marker = `%%SCNTOKEN${encodeIndex(tokens.length)}%%`
            tokens.push(html)
            markers.push(marker)
            return marker
        })
    })

    return output.replace(/%%SCNTOKEN([A-Z]+)%%/g, match => {
        const index = markers.indexOf(match)
        return index >= 0 ? tokens[index] : match
    })
}

function renderPlainCode(text: string): string {
    return `<div class="code-layer">${wrapKeywords(escapeCodeHtml(text))}</div>`
}

function renderStructuredCodeViewer(text: string): string {
    const lines = text.split('\n')
    const rows = lines.map((line, index) => `
        <div class="code-viewer-row">
            <span class="code-viewer-line-no">${index + 1}</span>
            <span class="code-viewer-line">${line || '<span class="code-viewer-line-empty"></span>'}</span>
        </div>
    `).join('')

    return `<div class="code-viewer">${rows}</div>`
}

function renderJsonCode(text: string): string {
    const escaped = escapeCodeHtml(text)
    const highlighted = applyTokenReplacements(escaped, [
        {
            pattern: /("(?:\\.|[^"\\])*")(\s*:)?/g,
            render: (_match, stringToken, colon = '') => {
                const className = colon ? 'token-key' : 'token-string'
                return `<span class="${className}">${stringToken}</span>${colon}`
            },
        },
        {
            pattern: /\b(true|false|null)\b/g,
            render: match => `<span class="token-boolean">${match}</span>`,
        },
        {
            pattern: /\b(-?\d+(?:\.\d+)?)\b/g,
            render: match => `<span class="token-number">${match}</span>`,
        },
        {
            pattern: /[{}[\],:]/g,
            render: match => `<span class="token-punctuation">${match}</span>`,
        },
    ])

    return renderStructuredCodeViewer(wrapKeywords(highlighted))
}

function renderYamlCode(text: string): string {
    const escaped = escapeCodeHtml(text)
    const highlighted = applyTokenReplacements(escaped, [
        {
            pattern: /(#.*)$/gm,
            render: match => `<span class="token-comment">${match}</span>`,
        },
        {
            pattern: /^(\s*[^:\n]+)(:)/gm,
            render: (_match, key, colon) => `<span class="token-key">${key}</span><span class="token-punctuation">${colon}</span>`,
        },
        {
            pattern: /("[^"]*"|'[^']*')/g,
            render: match => `<span class="token-string">${match}</span>`,
        },
        {
            pattern: /^(\s*-\s)/gm,
            render: match => `<span class="token-punctuation">${match}</span>`,
        },
        {
            pattern: /\b(true|false|null)\b/g,
            render: match => `<span class="token-boolean">${match}</span>`,
        },
        {
            pattern: /\b(-?\d+(?:\.\d+)?)\b/g,
            render: match => `<span class="token-number">${match}</span>`,
        },
    ])

    return renderStructuredCodeViewer(wrapKeywords(highlighted))
}

function highlightKeywordsInHtml(root: HTMLElement): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue || !KEYWORD_PATTERN.test(node.nodeValue)) {
                KEYWORD_PATTERN.lastIndex = 0
                return NodeFilter.FILTER_REJECT
            }
            KEYWORD_PATTERN.lastIndex = 0
            const parentTag = node.parentElement?.tagName
            if (['SCRIPT', 'STYLE', 'MARK', 'TEXTAREA', 'CODE', 'PRE'].includes(parentTag || '')) {
                return NodeFilter.FILTER_REJECT
            }
            return NodeFilter.FILTER_ACCEPT
        },
    })

    const textNodes: Text[] = []
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode as Text)
    }

    textNodes.forEach(node => {
        const fragment = document.createDocumentFragment()
        const parts = node.nodeValue?.split(KEYWORD_PATTERN) || []
        parts.forEach(part => {
            if (!part) {
                return
            }
            if (KEYWORD_PATTERN.test(part)) {
                const mark = document.createElement('mark')
                mark.className = 'keyword-highlight'
                mark.textContent = part
                fragment.appendChild(mark)
            } else {
                fragment.appendChild(document.createTextNode(part))
            }
            KEYWORD_PATTERN.lastIndex = 0
        })
        node.parentNode?.replaceChild(fragment, node)
    })
}

function renderMarkdownPreview(node: HTMLElement, text: string): void {
    marked.setOptions({
        gfm: true,
        breaks: true,
    })
    node.innerHTML = DOMPurify.sanitize(marked.parse(text) as string)
    highlightKeywordsInHtml(node)
}

function renderCodePreview(node: HTMLElement, text: string, mode: Mode): void {
    if (mode === 'json') {
        node.innerHTML = renderJsonCode(text)
        return
    }
    if (mode === 'yaml') {
        node.innerHTML = renderYamlCode(text)
        return
    }
    node.innerHTML = renderPlainCode(text)
}

export function renderEditorPreview(mode: Mode, text: string, previewNode: HTMLElement | null): void {
    if (!previewNode) {
        return
    }
    if (mode === 'md') {
        renderMarkdownPreview(previewNode, text)
        return
    }
    renderCodePreview(previewNode, text, mode)
}
