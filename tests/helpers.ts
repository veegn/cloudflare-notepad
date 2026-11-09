import assert from 'node:assert/strict'
import type { EditorView } from '@codemirror/view'
import type { APIRequestContext, Page } from '@playwright/test'
import type { BookPageItem, CreateDocPayload, CreateDocResult, HomeTreeResponse, Mode, TocItem, TreeNode } from '../frontend/core/types'

type CodeEditorHost = HTMLElement & { __scnView: EditorView }

type CreateDialogOptions = {
    type: CreateDocPayload['docType']
    path?: string
    title?: string
    summary?: string
}

export function uniqueNotePath() {
    return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function uniqueBookPath() {
    return `e2ebook-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export async function switchMode(page: Page, mode: Mode) {
    await page.locator('#mode-trigger').click()
    await page.locator(`.mode-picker-option[data-mode="${mode}"]`).click()
    await page.waitForFunction(expectedMode => window.CONFIG?.mode === expectedMode, mode)
}

export async function saveNote(request: APIRequestContext, notePath: string, content: string) {
    return request.put(`/api/notes/${notePath}`, {
        data: { content: content },
    })
}

export async function fillCodeEditor(page: Page, content: string) {
    await page.locator('#cm-editor').evaluate((node, value) => {
        const view = (node as CodeEditorHost).__scnView
        const current = view.state.doc.toString()
        view.dispatch({
            changes: { from: 0, to: current.length, insert: value },
        })
        view.focus()
    }, content)
}

export async function readCodeEditor(page: Page) {
    return page.locator('#cm-editor').evaluate(node => (node as CodeEditorHost).__scnView.state.doc.toString())
}

/** POST /api/docs — article or book only. */
async function createDoc(request: APIRequestContext, payload: CreateDocPayload) {
    const res = await request.post('/api/docs', { data: payload })
    const json: CreateDocResult = await res.json()
    assert.ok(json.data, json.message)
    return { status: res.status(), json: { ...json, data: json.data } }
}

export async function createArticle(request: APIRequestContext, path: string, title?: string) {
    return createDoc(request, {
        docType: 'article',
        path,
        title: title || path,
    })
}

export async function createBook(request: APIRequestContext, path: string, title?: string, summary?: string) {
    return createDoc(request, {
        docType: 'book',
        path,
        title: title || path,
        summary: summary || 'e2e book',
    })
}

/** POST /api/books/{book}/pages */
export async function createBookPage(request: APIRequestContext, book: string, title: string, path?: string) {
    const body: { title: string; path?: string } = { title }
    if (path) body.path = path
    const res = await request.post(`/api/books/${encodeURIComponent(book)}/pages`, { data: body })
    const json: { code: number; message?: string; data?: { docType: string; bookRef: string; path: string } } = await res.json()
    assert.ok(json.data, json.message)
    return { status: res.status(), json: { ...json, data: json.data } }
}

export async function getHomeTree(request: APIRequestContext): Promise<HomeTreeResponse> {
    // Always bypass cache so assertions see just-created docs.
    const res = await request.get('/api/home-tree?refresh=1')
    const json = await res.json()
    return json.data || { counts: { article: 0, book: 0 }, tree: [] }
}

export async function getBookToc(request: APIRequestContext, book: string): Promise<{ items: TocItem[] }> {
    const res = await request.get(`/api/toc?book=${encodeURIComponent(book)}`)
    const json = await res.json()
    return json.data || { items: [] }
}

export async function getBookPages(request: APIRequestContext, book: string): Promise<{ items: BookPageItem[] }> {
    const res = await request.get(`/api/books/${encodeURIComponent(book)}/pages`)
    const json = await res.json()
    return json.data || { items: [] }
}

export function flattenTree(nodes: TreeNode[], acc: TreeNode[] = []): TreeNode[] {
    for (const node of nodes || []) {
        acc.push(node)
        flattenTree(node.children || [], acc)
    }
    return acc
}

export function findTreePath(nodes: TreeNode[], path: string) {
    return flattenTree(nodes).find(n => n.path === path)
}

/** Open homepage create dialog via primary CTA. */
export async function openCreateDialog(page: Page) {
    await page.goto('/')
    await page.locator('#btn-new-doc').waitFor()
    await page.locator('#doc-tree .doc-tree-row, #doc-tree .doc-tree-empty, #doc-tree .doc-tree-loading').first().waitFor()
    // wait until loading placeholder is gone (tree initialized)
    await page.locator('#doc-tree .doc-tree-loading').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    await page.locator('#btn-new-doc').click()
    await page.locator('.modal-create-doc').first().waitFor({ state: 'visible' })
}

/** Fill create dialog (article|book) and submit; waits for navigation to edit. */
export async function submitCreateDialog(page: Page, { type, path, title, summary }: CreateDialogOptions) {
    const dialog = page.locator('.modal-create-doc').first()
    await dialog.locator(`.type-segment-btn[data-type="${type}"]`).click()
    if (path) await dialog.locator('#create-doc-path').fill(path)
    if (title) await dialog.locator('#create-doc-title').fill(title)
    if (summary && type === 'book') {
        const summaryInput = dialog.locator('#create-doc-summary')
        if (await summaryInput.count()) await summaryInput.fill(summary)
    }
    await Promise.all([
        page.waitForURL(/\/edit\//),
        dialog.locator('#create-doc-ok').click(),
    ])
}

/** Handle book editor "New page" prompt (showPrompt → confirm). */
export async function uiCreateBookPage(page: Page, bookPath: string, pageTitle: string) {
    await page.goto(`/edit/${bookPath}`)
    await page.locator('#btn-new-page').click()
    const promptInput = page.locator('.modal-dialog .modal-input')
    await promptInput.waitFor()
    await promptInput.fill(pageTitle)
    await page.locator('.modal-dialog .modal-btn-primary').click()
    // optional "edit now?" confirm — dismiss with cancel to stay on book editor
    const confirmBtn = page.locator('.modal-dialog .modal-btn-secondary')
    try {
        await confirmBtn.waitFor({ timeout: 2000 })
        await confirmBtn.click()
    } catch {
        // no follow-up confirm
    }
    await page.locator('.book-page-row').first().waitFor({ timeout: 10000 })
}
