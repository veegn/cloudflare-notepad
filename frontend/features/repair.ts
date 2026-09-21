import { getI18n } from '../core/config'
import { encodeNotePath } from '../core/pathUtils'
import { showToast, errHandle, showConfirm } from '../core/ui'

export interface RepairChange {
    kind: string
    detail: string
}

export interface RepairResult {
    path: string
    docType: string
    changes: RepairChange[]
    pagesChecked?: number
    pagesCreated?: number
    tocRebuilt?: boolean
}

function summarize(result: RepairResult): string {
    const n = (result.changes || []).length
    if (n === 0) return getI18n('repairNoChanges')
    const kinds = (result.changes || []).map(c => c.kind)
    const unique = Array.from(new Set(kinds)).slice(0, 4).join(',')
    return `${getI18n('repairDone').replace('{n}', String(n))}${unique ? ` · ${unique}` : ''}`
}

/** Drop browser-side TOC caches after a repair. */
export function clearRepairLocalCaches(bookPath?: string): void {
    try {
        const prefix = 'scn:toc:'
        const keys: string[] = []
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i)
            if (!k?.startsWith(prefix)) continue
            if (bookPath && !k.includes(bookPath)) continue
            keys.push(k)
        }
        keys.forEach(k => sessionStorage.removeItem(k))
    } catch {
        /* ignore */
    }
}

/** POST /api/repair?path=... — markdown body is baseline (prefer=h1). */
export async function repairDocPath(
    path: string,
    options: { prefer?: 'title' | 'h1'; rebuildToc?: boolean; createMissing?: boolean } = {},
): Promise<RepairResult> {
    const url = new URL('/api/repair', window.location.origin)
    url.searchParams.set('path', path)
    url.searchParams.set('prefer', options.prefer || 'h1')
    if (options.rebuildToc !== false) url.searchParams.set('rebuildToc', '1')
    // Create missing pages from book TOC links by default when repairing books.
    if (options.createMissing !== false) url.searchParams.set('createMissing', '1')

    const res = await fetch(url.toString(), { method: 'POST' })
    const text = await res.text()
    let json: { code: number; message?: string; data?: RepairResult }
    try {
        json = JSON.parse(text) as typeof json
    } catch {
        throw new Error(`${getI18n('repairFailed')} (${res.status})`)
    }
    if (!res.ok || json.code !== 0 || !json.data) {
        throw new Error(json.message || `${getI18n('repairFailed')} (${res.status})`)
    }
    return json.data
}

/** POST /api/repair?all=1 */
export async function repairAllDocs(limit = 50): Promise<{ count: number; results: RepairResult[] }> {
    const url = new URL('/api/repair', window.location.origin)
    url.searchParams.set('all', '1')
    url.searchParams.set('prefer', 'h1')
    url.searchParams.set('rebuildToc', '1')
    url.searchParams.set('createMissing', '1')
    url.searchParams.set('limit', String(limit))

    const res = await fetch(url.toString(), { method: 'POST' })
    const text = await res.text()
    let json: { code: number; message?: string; data?: { count?: number; results?: RepairResult[] } }
    try {
        json = JSON.parse(text) as typeof json
    } catch {
        throw new Error(`${getI18n('repairFailed')} (${res.status})`)
    }
    if (!res.ok || json.code !== 0 || !json.data) {
        throw new Error(json.message || `${getI18n('repairFailed')} (${res.status})`)
    }
    return {
        count: json.data.count ?? json.data.results?.length ?? 0,
        results: json.data.results || [],
    }
}

/** UI: repair one book from home tree / book contexts. */
export async function runRepairBook(bookPath: string): Promise<RepairResult | null> {
    if (!bookPath) return null
    const ok = await showConfirm(getI18n('repairConfirmBook').replace('{path}', bookPath))
    if (!ok) return null
    try {
        showToast(getI18n('repairRunning'))
        const result = await repairDocPath(bookPath, {
            prefer: 'h1',
            rebuildToc: true,
            createMissing: true,
        })
        clearRepairLocalCaches(bookPath)
        showToast(summarize(result))
        window.dispatchEvent(
            new CustomEvent('scn:repaired', { detail: { path: bookPath, result } }),
        )
        return result
    } catch (err) {
        errHandle(err)
        return null
    }
}

/** UI: repair entire library (home toolbar). */
export async function runRepairAll(): Promise<void> {
    const ok = await showConfirm(getI18n('repairConfirmAll'))
    if (!ok) return
    try {
        showToast(getI18n('repairRunning'))
        const out = await repairAllDocs(80)
        const changed = out.results.filter(r => (r.changes || []).length > 0).length
        clearRepairLocalCaches()
        showToast(
            getI18n('repairAllDone')
                .replace('{books}', String(changed))
                .replace('{total}', String(out.count)),
        )
        window.dispatchEvent(new CustomEvent('scn:repaired', { detail: { all: true } }))
    } catch (err) {
        errHandle(err)
    }
}

export function repairHref(bookPath: string): string {
    return `/api/repair?path=${encodeNotePath(bookPath)}&rebuildToc=1&createMissing=1&prefer=h1`
}
