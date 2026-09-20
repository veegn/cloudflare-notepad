function uniqueNotePath() {
    return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function uniqueBookPath() {
    return `e2ebook-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

async function switchMode(page, mode) {
    await page.locator('#mode-trigger').click()
    await page.locator(`.mode-picker-option[data-mode="${mode}"]`).click()
    await page.waitForFunction(expectedMode => window.CONFIG?.mode === expectedMode, mode)
}

async function saveNote(request, notePath, content) {
    return request.put(`/api/notes/${notePath}`, {
        data: { content: content },
    })
}

async function fillCodeEditor(page, content) {
    await page.locator('#cm-editor').evaluate((node, value) => {
        const view = node.__scnView
        const current = view.state.doc.toString()
        view.dispatch({
            changes: { from: 0, to: current.length, insert: value },
        })
        view.focus()
    }, content)
}

async function readCodeEditor(page) {
    return page.locator('#cm-editor').evaluate(node => node.__scnView.state.doc.toString())
}

/** POST /api/docs — article or book only. */
async function createDoc(request, payload) {
    const res = await request.post('/api/docs', { data: payload })
    const json = await res.json()
    return { status: res.status(), json }
}

async function createArticle(request, path, title) {
    return createDoc(request, {
        docType: 'article',
        path,
        title: title || path,
    })
}

async function createBook(request, path, title, summary) {
    return createDoc(request, {
        docType: 'book',
        path,
        title: title || path,
        summary: summary || 'e2e book',
    })
}

/** POST /api/books/{book}/pages */
async function createBookPage(request, book, title, path) {
    const body = { title }
    if (path) body.path = path
    const res = await request.post(`/api/books/${encodeURIComponent(book)}/pages`, { data: body })
    const json = await res.json()
    return { status: res.status(), json }
}

async function getHomeTree(request) {
    const res = await request.get('/api/home-tree')
    const json = await res.json()
    return json.data || { counts: { article: 0, book: 0 }, tree: [] }
}

async function getBookToc(request, book) {
    const res = await request.get(`/api/toc?book=${encodeURIComponent(book)}`)
    const json = await res.json()
    return json.data || { items: [] }
}

async function getBookPages(request, book) {
    const res = await request.get(`/api/books/${encodeURIComponent(book)}/pages`)
    const json = await res.json()
    return json.data || { items: [] }
}

function flattenTree(nodes, acc = []) {
    for (const node of nodes || []) {
        acc.push(node)
        flattenTree(node.children || [], acc)
    }
    return acc
}

function findTreePath(nodes, path) {
    return flattenTree(nodes).find(n => n.path === path)
}

/** Open homepage create dialog via primary CTA. */
async function openCreateDialog(page) {
    await page.goto('/')
    await page.locator('#btn-new-doc').waitFor()
    await page.locator('#doc-tree .doc-tree-row, #doc-tree .doc-tree-empty, #doc-tree .doc-tree-loading').first().waitFor()
    // wait until loading placeholder is gone (tree initialized)
    await page.locator('#doc-tree .doc-tree-loading').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    await page.locator('#btn-new-doc').click()
    await page.locator('.modal-create-doc').first().waitFor({ state: 'visible' })
}

/** Fill create dialog (article|book) and submit; waits for navigation to edit. */
async function submitCreateDialog(page, { type, path, title, summary }) {
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
async function uiCreateBookPage(page, bookPath, pageTitle) {
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

module.exports = {
    fillCodeEditor,
    readCodeEditor,
    uniqueNotePath,
    uniqueBookPath,
    switchMode,
    saveNote,
    createDoc,
    createArticle,
    createBook,
    createBookPage,
    getHomeTree,
    getBookToc,
    getBookPages,
    flattenTree,
    findTreePath,
    openCreateDialog,
    submitCreateDialog,
    uiCreateBookPage,
}
