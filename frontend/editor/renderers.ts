import type { Mode } from '../core/types'
import { renderCodePreview } from './codePreview'
import { isMarkdownSanitizationSupported, renderMarkdownPreview } from './markdownPreview'

export { escapeHtml } from '../core/html'
export { escapeCodeHtml, wrapKeywords } from './highlighting'
export { renderMarkdownFocusOverlay, resolveAssetSrc } from './markdownPreview'

function renderSourceFallback(node: HTMLElement, text: string): void {
    const source = document.createElement('pre')
    source.className = 'document-source'
    source.textContent = text
    node.textContent = ''
    node.appendChild(source)
}

export function renderEditorPreview(mode: Mode, text: string, previewNode: HTMLElement | null): void {
    if (!previewNode) return

    try {
        if (mode === 'md') {
            if (!isMarkdownSanitizationSupported()) {
                renderSourceFallback(previewNode, text)
                return
            }

            renderMarkdownPreview(previewNode, text)
            return
        }

        previewNode.innerHTML = renderCodePreview(text, mode)
    } catch (error) {
        console.error('Document preview failed', error)
        renderSourceFallback(previewNode, text)
    }
}
