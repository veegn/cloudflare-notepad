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
    const qs = params.toString()
    const url = `/api/upload${qs ? `?${qs}` : ''}`

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': type || 'application/octet-stream',
            'X-Filename': file.name || 'image',
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
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif'
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => {
        const file = input.files?.[0]
        input.remove()
        if (!file) return
        void handleImageFile(file, insert, notePath)
    })
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
