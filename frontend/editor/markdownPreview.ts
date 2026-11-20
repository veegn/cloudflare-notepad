import { CONFIG, getI18n } from '../core/config'
import { escapeHtml } from '../core/html'
import { escapeCodeHtml, highlightKeywordsInHtml, wrapKeywords } from './highlighting'
import { enhanceMarkdownCode } from './markdownCode'
import { addMarkdownHeadingLinks, enableImageLightbox, enhanceMarkdownTablesAndTasks, normalizeMarkdownLinks } from './markdownReading'
import { marked } from 'marked'
import markedAlert from 'marked-alert'
import DOMPurify from 'dompurify'

marked.use(markedAlert())
marked.use({
    renderer: {
        code(token) {
            if (token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() === 'mermaid') {
                return `<div class="mermaid mermaid-source">${escapeHtml(token.text)}</div>\n`
            }
            return false
        },
    },
})

let mermaidLoading: Promise<Window['mermaid']> | undefined
const pendingDiagrams = new Set<HTMLElement>()
let renderingDiagrams = false
let diagramId = 0

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

function rewriteImageSrcs(root: ParentNode): void {
    root.querySelectorAll<HTMLImageElement>('img[src]').forEach(image => {
        const src = image.getAttribute('src')
        if (!src) return

        image.setAttribute('loading', 'lazy')
        image.setAttribute('decoding', 'async')
        const resolvedSrc = resolveAssetSrc(src)
        if (resolvedSrc !== src) image.setAttribute('src', resolvedSrc)
        enableImageLightbox(image)
    })
}

function loadMermaid(): Promise<Window['mermaid']> {
    if (!mermaidLoading) {
        mermaidLoading = new Promise(resolve => {
            const script = document.createElement('script')
            const bundle = new URL(import.meta.url)
            const library = new URL('./mermaid.min.js', bundle)
            library.search = bundle.search
            script.src = library.href
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

function queueMermaidDiagrams(nodes: NodeListOf<HTMLElement>): void {
    const supportsMermaid =
        typeof CSSStyleSheet !== 'undefined' &&
        typeof CSSStyleSheet.prototype.replaceSync === 'function'
    if (!nodes.length) return
    if (!supportsMermaid) {
        nodes.forEach(finishDiagramLoading)
        return
    }

    nodes.forEach(node => pendingDiagrams.add(node))
    if (!renderingDiagrams) void renderQueuedMermaid()
}

function finishDiagramLoading(node: HTMLElement): void {
    const wrapper = node.parentElement
    wrapper?.classList.remove('is-loading')
    wrapper?.removeAttribute('aria-busy')
    wrapper?.querySelector('.md-diagram-status')?.remove()
}

async function renderQueuedMermaid(): Promise<void> {
    renderingDiagrams = true
    try {
        const mermaid = await loadMermaid()
        if (!mermaid) return

        // Mermaid configuration is shared, so a theme change queues another pass.
        while (pendingDiagrams.size > 0) {
            const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default'
            mermaid.initialize({ startOnLoad: false, theme, suppressErrorRendering: true })
            const nodes = Array.from(pendingDiagrams)
            pendingDiagrams.clear()
            for (const node of nodes) {
                const source = node.dataset.mermaidSource
                if (!node.isConnected || source === undefined) continue

                try {
                    const { svg, bindFunctions } = await mermaid.render(`scn-mermaid-${++diagramId}`, source)
                    if (!node.isConnected) continue
                    node.innerHTML = svg
                    const graphic = node.querySelector('svg')
                    const width = graphic?.viewBox.baseVal.width
                    if (graphic && width) graphic.style.setProperty('--md-diagram-width', `${Math.ceil(width)}px`)
                    node.classList.remove('mermaid-source')
                    bindFunctions?.(node)
                } catch {
                    // The original source stays in place until the first successful render.
                } finally {
                    finishDiagramLoading(node)
                }
            }
        }
    } catch (error) {
        console.error('Mermaid initialization failed', error)
    } finally {
        pendingDiagrams.forEach(finishDiagramLoading)
        pendingDiagrams.clear()
        renderingDiagrams = false
    }
}

window.addEventListener('scn:theme-change', () => {
    queueMermaidDiagrams(document.querySelectorAll<HTMLElement>('.mermaid[data-mermaid-source]'))
})

export function renderMarkdownPreview(node: HTMLElement, text: string): void {
    marked.setOptions({ gfm: true, breaks: true })
    const fragment = DOMPurify.sanitize(marked.parse(text) as string, { RETURN_DOM_FRAGMENT: true })
    rewriteImageSrcs(fragment)
    node.textContent = ''
    node.append(fragment)
    normalizeMarkdownLinks(node)
    highlightKeywordsInHtml(node)
    enhanceMarkdownCode(node)
    enhanceMarkdownTablesAndTasks(node)
    addMarkdownHeadingLinks(node)

    const diagrams = node.querySelectorAll<HTMLElement>('.mermaid.mermaid-source')
    diagrams.forEach(diagram => {
        diagram.dataset.mermaidSource = diagram.textContent ?? ''
        const wrapper = document.createElement('div')
        wrapper.className = 'md-diagram is-loading'
        wrapper.tabIndex = 0
        wrapper.setAttribute('role', 'region')
        wrapper.setAttribute('aria-label', getI18n('markdownDiagram'))
        wrapper.setAttribute('aria-busy', 'true')
        const status = document.createElement('div')
        status.className = 'md-diagram-status'
        status.textContent = getI18n('markdownDiagramLoading')
        diagram.before(wrapper)
        wrapper.append(status, diagram)
    })
    queueMermaidDiagrams(diagrams)
}

export function isMarkdownSanitizationSupported(): boolean {
    return DOMPurify.isSupported
}
