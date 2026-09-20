import { getI18n } from './config'
import { encodeNotePath } from './pathUtils'
import { showToast, errHandle, showConfirm } from './ui'

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
    return getI18n('repairDone').replace('{n}', String(n))
}

/** POST /api/repair?path=... for a single book/note. */
export async function repairDocPath(
    path: string,
    options: { prefer?: 'title' | 'h1'; rebuildToc?: boolean; createMissing?: boolean } = {},
): Promise<RepairResult> {
    const url = new URL('/api/repair', window.location.origin)
    url.searchParams.set('path', path)
    // Body-first: markdown H1 / book TOC are the baseline for metadata.
    url.searchParams.set('prefer', options.prefer || 'h1')
    if (options.rebuildToc !== false) url.searchParams.set('rebuildToc', '1')
    if (options.createMissing) url.searchParams.set('createMissing', '1')

    const res = await fetch(url.toString(), { method: 'POST' })
    const json = (await res.json()) as { code: number; message?: string; data?: RepairResult }
    if (json.code !== 0 || !json.data) {
        throw new Error(json.message || getI18n('repairFailed'))
    }
    return json.data
}

/** POST /api/repair?all=1 */
export async function repairAllDocs(limit = 50): Promise<{ count: number; results: RepairResult[] }> {
    const url = new URL('/api/repair', window.location.origin)
    url.searchParams.set('all', '1')
    url.searchParams.set('prefer', 'h1')
    url.searchParams.set('rebuildToc', '1')
    url.searchParams.set('limit', String(limit))

    const res = await fetch(url.toString(), { method: 'POST' })
    const json = (await res.json()) as {
        code: number
        message?: string
        data?: { count?: number; results?: RepairResult[] }
    }
    if (json.code !== 0 || !json.data) {
        throw new Error(json.message || getI18n('repairFailed'))
    }
    return {
        count: json.data.count ?? json.data.results?.length ?? 0,
        results: json.data.results || [],
    }
}

/** UI: repair one book (used by sidebar + home tree). */
export async function runRepairBook(bookPath: string): Promise<void> {
    if (!bookPath) return
    const ok = await showConfirm(getI18n('repairConfirmBook').replace('{path}', bookPath))
    if (!ok) return
    try {
        const result = await repairDocPath(bookPath, { prefer: 'h1', rebuildToc: true })
        showToast(summarize(result))
        // let caller reload list/toc
        window.dispatchEvent(
            new CustomEvent('scn:repaired', { detail: { path: bookPath, result } }),
        )
    } catch (err) {
        errHandle(err)
    }
}

/** UI: repair entire library (home toolbar). */
export async function runRepairAll(): Promise<void> {
    const ok = await showConfirm(getI18n('repairConfirmAll'))
    if (!ok) return
    try {
        const out = await repairAllDocs(80)
        const changed = out.results.filter(r => (r.changes || []).length > 0).length
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
    return `/api/repair?path=${encodeNotePath(bookPath)}&rebuildToc=1`
}
