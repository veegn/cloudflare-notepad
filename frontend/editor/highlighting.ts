import { KEYWORD_PATTERN } from '../core/config'

/** Escape code text without encoding quotes so token rules can still match them. */
export function escapeCodeHtml(text = ''): string {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

export function wrapKeywords(text: string): string {
    return text.replace(KEYWORD_PATTERN, '<mark class="keyword-highlight">$1</mark>')
}

export function highlightKeywordsInHtml(root: HTMLElement): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue || !KEYWORD_PATTERN.test(node.nodeValue)) {
                KEYWORD_PATTERN.lastIndex = 0
                return NodeFilter.FILTER_REJECT
            }
            KEYWORD_PATTERN.lastIndex = 0

            const parent = node.parentElement
            const excludedTags = ['SCRIPT', 'STYLE', 'MARK', 'TEXTAREA', 'CODE', 'PRE']
            if (parent?.closest('.mermaid') || excludedTags.includes(parent?.tagName || '')) {
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
            if (!part) return

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
