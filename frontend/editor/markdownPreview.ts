import { CONFIG } from '../core/config'
import { escapeHtml } from '../core/html'
import { escapeCodeHtml, highlightKeywordsInHtml, wrapKeywords } from './highlighting'
import { marked } from 'marked'
import markedAlert from 'marked-alert'
import DOMPurify from 'dompurify'

marked.use(markedAlert())
marked.use({
    renderer: {
        code(token) {
            if (token.lang === 'mermaid') {
                return `<div class="mermaid mermaid-source">${escapeHtml(token.text)}</div>\n`
            }
            return false
        },
    },
})

let mermaidLoading: Promise<Window['mermaid']> | undefined

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

/** Resolve relative image paths from exported documents to `/assets/...` URLs. */
export function resolveAssetSrc(src: string, notePath = CONFIG.notePath): string {
    if (!src) return src
    if (/^(https?:|data:|blob:)/i.test(src)) return src
    if (src.startsWith('/')) return src

    const relativePath = src.replace(/^\.\//, '')
    const noteDirectory = (notePath || '').split('/').slice(0, -1).filter(Boolean).join('/')
    const isLegacyAssetPath =
        relativePath.includes('.assets/') ||
        relativePath.startsWith('_assets/') ||
        relativePath.includes('/_assets/')

    if (isLegacyAssetPath) {
        const assetPath = noteDirectory ? `${noteDirectory}/${relativePath}` : relativePath
        return `/assets/${assetPath.replace(/\/{2,}/g, '/')}`
    }

    const assetPath = notePath ? `${notePath}/${relativePath}` : relativePath
    return `/assets/${assetPath}`.replace(/\/{2,}/g, '/')
}

function rewriteImageSrcs(root: HTMLElement): void {
    root.querySelectorAll('img[src]').forEach(image => {
        const src = image.getAttribute('src')
        if (!src) return

        const resolvedSrc = resolveAssetSrc(src)
        if (resolvedSrc !== src) image.setAttribute('src', resolvedSrc)
    })
}

function loadMermaid(): Promise<Window['mermaid']> {
    if (!mermaidLoading) {
        mermaidLoading = new Promise(resolve => {
            const script = document.createElement('script')
            script.src = '/js/mermaid.min.js'
            script.onload = () => resolve(window.mermaid)
            script.onerror = () => {
                mermaidLoading = undefined
                script.remove()
                resolve(undefined)
            }
            document.head.appendChild(script)
        })
    }

    return mermaidLoading
}

async function renderMermaidDiagrams(nodes: NodeListOf<HTMLElement>): Promise<void> {
    const supportsMermaid =
        typeof CSSStyleSheet !== 'undefined' &&
        typeof CSSStyleSheet.prototype.replaceSync === 'function'
    if (!nodes.length || !supportsMermaid) return

    const mermaid = await loadMermaid()
    if (!mermaid) return

    const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default'
    mermaid.initialize({ startOnLoad: false, theme })
    for (const node of nodes) {
        if (!node.isConnected) continue

        const source = node.textContent
        try {
            await mermaid.run({ nodes: [node] })
            node.classList.remove('mermaid-source')
        } catch {
            node.textContent = source
        }
    }
}

export function renderMarkdownPreview(node: HTMLElement, text: string): void {
    marked.setOptions({ gfm: true, breaks: true })
    node.innerHTML = DOMPurify.sanitize(marked.parse(text) as string)
    rewriteImageSrcs(node)
    highlightKeywordsInHtml(node)

    void renderMermaidDiagrams(node.querySelectorAll<HTMLElement>('.mermaid')).catch(error => {
        console.error('Mermaid initialization failed', error)
    })
}

export function isMarkdownSanitizationSupported(): boolean {
    return DOMPurify.isSupported
}
