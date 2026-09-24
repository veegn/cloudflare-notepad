import { CONFIG, getI18n } from '../core/config'
import { showToast, errHandle } from '../core/ui'

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])
const MAX_BYTES = 8 * 1024 * 1024

export type UploadResult = {
    url: string
    path: string
    contentType: string
    markdown?: string
}

export function markdownImage(url: string, alt = 'image'): string {
    return `![${alt}](${url})`
}

/** HTTP header values must be ISO-8859-1; strip/replace other code points. */
function asciiHeaderValue(name: string): string {
    const raw = (name || '').trim()
    if (!raw) return 'image'
    let out = ''
    for (const ch of raw) {
        const code = ch.codePointAt(0) ?? 0
        // Skip CR/LF; keep Latin-1 printable + common filename chars
        if (code === 10 || code === 13) continue
        if (code <= 0xff) out += ch
        else out += '-'
    }
    const cleaned = out.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '')
    return cleaned || 'image'
}

/** Upload image bytes; returns public URL + markdown snippet. */
export async function uploadImageFile(file: File, notePath?: string): Promise<UploadResult> {
    const type = (file.type || '').toLowerCase()
    if (!ALLOWED.has(type)) {
        throw new Error(getI18n('uploadUnsupported'))
    }
    if (file.size > MAX_BYTES) {
        throw new Error(getI18n('uploadTooLarge'))
    }

    const params = new URLSearchParams()
    if (notePath && notePath !== '_index') {
        params.set('note', notePath)
    }
    // UTF-8 filename goes in query (headers cannot hold non ISO-8859-1)
    const displayName = (file.name || 'image').trim() || 'image'
    params.set('name', displayName)
    const qs = params.toString()
    const url = `/api/upload${qs ? `?${qs}` : ''}`

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': type || 'application/octet-stream',
            // ASCII-only fallback for older API paths
            'X-Filename': asciiHeaderValue(displayName),
        },
        body: file,
    })
    const text = await res.text()
    let json: { code: number; message?: string; data?: UploadResult }
    try {
        json = JSON.parse(text) as typeof json
    } catch {
        throw new Error(`${getI18n('uploadFailed')} (${res.status})`)
    }
    if (!res.ok || json.code !== 0 || !json.data) {
        throw new Error(json.message || `${getI18n('uploadFailed')} (${res.status})`)
    }
    return json.data
}

export type InsertText = (text: string) => void

/** Pick a file via hidden input and insert markdown after upload. */
export function pickAndUploadImage(insert: InsertText, notePath?: string): void {
    // Reuse one off-screen input: display:none file inputs can be ignored
    // by some browsers, and a fresh node each click races the user gesture.
    let input = document.getElementById('scn-image-file-input') as HTMLInputElement | null
    if (!input) {
        input = document.createElement('input')
        input.id = 'scn-image-file-input'
        input.type = 'file'
        input.accept = 'image/png,image/jpeg,image/webp,image/gif'
        input.style.position = 'fixed'
        input.style.left = '-9999px'
        input.style.width = '1px'
        input.style.height = '1px'
        input.style.opacity = '0'
        document.body.appendChild(input)
    }
    input.value = ''
    input.onchange = () => {
        const file = input?.files?.[0]
        if (!file) return
        void handleImageFile(file, insert, notePath)
    }
    showToast(getI18n('uploadPickFile'))
    input.click()
}

export async function handleImageFile(
    file: File,
    insert: InsertText,
    notePath?: string,
): Promise<void> {
    try {
        showToast(getI18n('uploadUploading'))
        const result = await uploadImageFile(file, notePath || CONFIG.notePath)
        const alt = file.name.replace(/\.[^.]+$/, '') || 'image'
        insert(result.markdown || markdownImage(result.url, alt))
        showToast(getI18n('uploadDone'))
    } catch (err) {
        errHandle(err)
    }
}

/** Extract image files from clipboard / drop events. */
export function imageFilesFrom(dataTransfer: DataTransfer | null): File[] {
    if (!dataTransfer) return []
    const files: File[] = []
    const list = dataTransfer.files
    for (let i = 0; i < list.length; i++) {
        const f = list.item(i)
        if (f && ALLOWED.has((f.type || '').toLowerCase())) files.push(f)
    }
    const items = dataTransfer.items
    if (items) {
        for (let i = 0; i < items.length; i++) {
            const item = items[i]
            if (item.kind === 'file') {
                const f = item.getAsFile()
                if (f && ALLOWED.has((f.type || '').toLowerCase())) {
                    if (!files.some(x => x.name === f.name && x.size === f.size)) {
                        files.push(f)
                    }
                }
            }
        }
    }
    return files
}
