/** Path helpers shared by home tree and book sidebar. */

/** Encode each path segment but keep `/` so Worker wildcard routes work. */
export function encodeNotePath(path: string): string {
    return path
        .split('/')
        .map(seg => encodeURIComponent(seg))
        .join('/')
}

export function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/** Element helper that returns HTMLElement (for dataset etc.). */
export function el(selector: string, parent: ParentNode = document): HTMLElement | null {
    const node = parent.querySelector(selector)
    return node instanceof HTMLElement ? node : null
}

export function input(selector: string, parent: ParentNode = document): HTMLInputElement | null {
    const node = parent.querySelector(selector)
    return node instanceof HTMLInputElement ? node : null
}
