const { test, expect } = require('@playwright/test')
const {
    uniqueNotePath,
    uniqueBookPath,
    createArticle,
    createBook,
    createBookPage,
    createDoc,
    getHomeTree,
    getBookToc,
    getBookPages,
    flattenTree,
    findTreePath,
    openCreateDialog,
    submitCreateDialog,
    uiCreateBookPage,
    saveNote,
} = require('./helpers')

test.describe('doc type API', () => {
    test('POST /api/docs creates article and book', async ({ request }) => {
        const articlePath = uniqueNotePath()
        const bookPath = uniqueBookPath()

        const article = await createArticle(request, articlePath, 'E2E Article')
        expect(article.status).toBe(200)
        expect(article.json.code).toBe(0)
        expect(article.json.data.docType).toBe('article')
        expect(article.json.data.path).toBe(articlePath)
        expect(article.json.data.editUrl).toContain('/edit/')

        const book = await createBook(request, bookPath, 'E2E Book', 'summary here')
        expect(book.status).toBe(200)
        expect(book.json.code).toBe(0)
        expect(book.json.data.docType).toBe('book')
        expect(book.json.data.path).toBe(bookPath)

        const tree = await getHomeTree(request)
        const flat = flattenTree(tree.tree)
        expect(findTreePath(tree.tree, articlePath)?.nodeType).toBe('article')
        expect(findTreePath(tree.tree, bookPath)?.nodeType).toBe('book')
        expect(flat.some(n => n.nodeType === 'page')).toBe(false)
    })

    test('POST /api/docs rejects docType=page', async ({ request }) => {
        const res = await request.post('/api/docs', {
            data: { docType: 'page', path: uniqueNotePath(), title: 'nope' },
        })
        expect(res.status()).toBe(400)
        const json = await res.json()
        expect(json.code).not.toBe(0)
        expect(String(json.message || '')).toMatch(/book editor|分页/i)
    })

    test('POST /api/docs rejects book without title', async ({ request }) => {
        const res = await request.post('/api/docs', {
            data: { docType: 'book', path: uniqueBookPath() },
        })
        expect(res.status()).toBe(400)
    })

    test('book page create appends TOC and home tree hides pages', async ({ request }) => {
        const bookPath = uniqueBookPath()
        const created = await createBook(request, bookPath, 'Tree Hide Book')
        expect(created.json.code).toBe(0)

        const pageTitle = 'Hidden Page Title'
        const pageRes = await createBookPage(request, bookPath, pageTitle)
        expect(pageRes.status).toBe(200)
        expect(pageRes.json.code).toBe(0)
        expect(pageRes.json.data.docType).toBe('page')
        expect(pageRes.json.data.bookRef).toBe(bookPath)
        expect(pageRes.json.data.path).toMatch(new RegExp(`^${bookPath}/`))

        const pagePath = pageRes.json.data.path
        const toc = await getBookToc(request, bookPath)
        const tocPaths = (toc.items || []).filter(i => i.path).map(i => i.path)
        expect(tocPaths).toContain(pagePath)
        const tocItem = toc.items.find(i => i.path === pagePath)
        expect(tocItem.exists).toBe(true)
        expect(tocItem.title).toBe(pageTitle)

        const pages = await getBookPages(request, bookPath)
        expect(pages.items.some(i => i.path === pagePath && i.exists)).toBe(true)

        const tree = await getHomeTree(request)
        const flat = flattenTree(tree.tree)
        expect(flat.some(n => n.path === pagePath)).toBe(false)
        const bookNode = findTreePath(tree.tree, bookPath)
        expect(bookNode?.nodeType).toBe('book')
        expect(bookNode?.pageCount).toBeGreaterThanOrEqual(1)
        expect((bookNode?.children || []).some(c => c.path === pagePath)).toBe(false)
    })

    test('DELETE page removes TOC link when syncBook=1', async ({ request }) => {
        const bookPath = uniqueBookPath()
        await createBook(request, bookPath, 'Delete Sync Book')
        const pageRes = await createBookPage(request, bookPath, 'Doomed Page')
        const pagePath = pageRes.json.data.path

        const del = await request.delete(`/api/notes/${pagePath}?syncBook=1`)
        expect(del.ok()).toBeTruthy()

        const toc = await getBookToc(request, bookPath)
        const tocPaths = (toc.items || []).filter(i => i.path).map(i => i.path)
        expect(tocPaths).not.toContain(pagePath)

        const pageGet = await request.get(`/api/notes/${pagePath}`)
        const pageJson = await pageGet.json()
        expect(pageJson.data?.content ?? '').toBe('')
    })

    test('nested article paths create virtual directory nodes', async ({ request }) => {
        const dir = `e2edir-${Date.now().toString(36)}`
        const childPath = `${dir}/nested-note`
        const created = await createArticle(request, childPath, 'Nested Note')
        expect(created.json.code).toBe(0)

        const tree = await getHomeTree(request)
        const dirNode = findTreePath(tree.tree, dir)
        expect(dirNode?.nodeType).toBe('dir')
        const child = (dirNode?.children || []).find(c => c.path === childPath)
        expect(child?.nodeType).toBe('article')
    })
})

test.describe('homepage document tree UI', () => {
    test('shows book/article badges and does not list book pages', async ({ page, request }) => {
        const bookPath = uniqueBookPath()
        const articlePath = uniqueNotePath()
        const pageTitle = 'UI Hidden Page'

        await createBook(request, bookPath, 'UI Book Card')
        await createArticle(request, articlePath, 'UI Article Row')
        const pageRes = await createBookPage(request, bookPath, pageTitle)
        const pagePath = pageRes.json.data.path

        await page.goto('/')
        const tree = page.locator('#doc-tree')
        await expect(tree).toBeVisible()
        await expect(tree.locator(`.doc-tree-row[data-path="${bookPath}"]`)).toBeVisible()
        await expect(tree.locator(`.doc-tree-row[data-path="${bookPath}"] .badge-book`)).toBeVisible()
        await expect(tree.locator(`.doc-tree-row[data-path="${articlePath}"] .badge-article`)).toBeVisible()
        await expect(tree.locator(`.doc-tree-row[data-path="${pagePath}"]`)).toHaveCount(0)
        await expect(tree.locator(`text=${pageTitle}`)).toHaveCount(0)
    })

    test('create dialog only offers article and book', async ({ page }) => {
        await openCreateDialog(page)
        const dialog = page.locator('.modal-create-doc').first()
        const types = dialog.locator('.type-segment-btn')
        await expect(types).toHaveCount(2)
        await expect(types.nth(0)).toHaveAttribute('data-type', 'article')
        await expect(types.nth(1)).toHaveAttribute('data-type', 'book')
        await expect(dialog.locator('.type-segment-btn[data-type="page"]')).toHaveCount(0)
    })

    test('create book from dialog lands on book editor with page manager', async ({ page }) => {
        const bookPath = uniqueBookPath()
        const title = 'Dialog Book'
        await openCreateDialog(page)
        await submitCreateDialog(page, { type: 'book', path: bookPath, title, summary: 'from dialog' })

        await expect(page).toHaveURL(new RegExp(`/edit/${bookPath}$`))
        await expect(page.locator('#doc-sidebar')).toBeVisible()
        await expect(page.locator('#btn-new-page')).toBeVisible()
        await expect(page.locator('#doc-sidebar-body')).toBeVisible()
    })

    test('create article from dialog has no doc sidebar', async ({ page }) => {
        const articlePath = uniqueNotePath()
        await openCreateDialog(page)
        await submitCreateDialog(page, { type: 'article', path: articlePath, title: 'Dialog Article' })

        await expect(page).toHaveURL(new RegExp(`/edit/${articlePath}$`))
        await expect(page.locator('#doc-sidebar')).toHaveCount(0)
        await expect(page.locator('#cm-editor')).toBeVisible()
    })

    test('directory row expands to reveal nested articles', async ({ page, request }) => {
        const dir = `e2etree-${Date.now().toString(36)}`
        const childPath = `${dir}/leaf`
        await createArticle(request, childPath, 'Leaf Under Dir')

        await page.goto('/')
        // clear expand state so dir starts collapsed
        await page.evaluate(() => localStorage.removeItem('homeTreeExpand'))

        const dirRow = page.locator(`#doc-tree .doc-tree-row[data-path="${dir}"]`)
        await expect(dirRow).toBeVisible()
        await expect(dirRow).toHaveClass(/is-dir/)
        await expect(page.locator(`#doc-tree .doc-tree-row[data-path="${childPath}"]`)).toHaveCount(0)

        await dirRow.locator('.doc-tree-title').click()
        await expect(page.locator(`#doc-tree .doc-tree-row[data-path="${childPath}"]`)).toBeVisible()
        await expect(dirRow).toHaveAttribute('aria-expanded', 'true')
    })

    test('filter by books hides articles', async ({ page, request }) => {
        const bookPath = uniqueBookPath()
        const articlePath = uniqueNotePath()
        await createBook(request, bookPath, 'Filter Book')
        await createArticle(request, articlePath, 'Filter Article')

        await page.goto('/')
        await page.locator('.home-chip[data-filter="book"]').click()
        await expect(page.locator(`#doc-tree .doc-tree-row[data-path="${bookPath}"]`)).toBeVisible()
        await expect(page.locator(`#doc-tree .doc-tree-row[data-path="${articlePath}"]`)).toHaveCount(0)

        await page.locator('.home-chip[data-filter="article"]').click()
        await expect(page.locator(`#doc-tree .doc-tree-row[data-path="${articlePath}"]`)).toBeVisible()
        await expect(page.locator(`#doc-tree .doc-tree-row[data-path="${bookPath}"]`)).toHaveCount(0)
    })

    test('search filters tree rows', async ({ page, request }) => {
        const keepPath = uniqueNotePath()
        const dropPath = uniqueNotePath()
        await createArticle(request, keepPath, 'KeepUniqueAlpha')
        await createArticle(request, dropPath, 'DropUniqueBeta')

        await page.goto('/')
        await page.locator('#home-search').fill('KeepUniqueAlpha')
        await expect(page.locator(`#doc-tree .doc-tree-row[data-path="${keepPath}"]`)).toBeVisible()
        await expect(page.locator(`#doc-tree .doc-tree-row[data-path="${dropPath}"]`)).toHaveCount(0)
    })
})

test.describe('book editor page CRUD UI', () => {
    test('create page from sidebar updates list and TOC data', async ({ page, request }) => {
        const bookPath = uniqueBookPath()
        await createBook(request, bookPath, 'CRUD Book')
        const pageTitle = 'UI Created Page'

        await uiCreateBookPage(page, bookPath, pageTitle)

        const body = page.locator('#doc-sidebar-body')
        await expect(body.locator('.book-page-row', { hasText: pageTitle })).toBeVisible()

        const pages = await getBookPages(request, bookPath)
        expect(pages.items.some(i => i.title === pageTitle && i.exists)).toBe(true)

        const toc = await getBookToc(request, bookPath)
        expect((toc.items || []).some(i => i.title === pageTitle && i.exists)).toBe(true)
    })

    test('page view shows read-only TOC sidebar; article view does not', async ({ page, request }) => {
        const bookPath = uniqueBookPath()
        const articlePath = uniqueNotePath()
        await createBook(request, bookPath, 'Toc Book')
        const pageRes = await createBookPage(request, bookPath, 'Toc Page')
        const pagePath = pageRes.json.data.path
        await createArticle(request, articlePath, 'Plain Article')

        await page.goto(`/note/${pagePath}`)
        await expect(page.locator('#doc-sidebar')).toBeVisible()
        await expect(page.locator('#doc-sidebar')).toHaveAttribute('data-doc-type', 'page')
        await expect(page.locator('#doc-sidebar-body .doc-toc-item', { hasText: 'Toc Page' }).first()).toBeVisible()
        await expect(page.locator('#btn-new-page')).toHaveCount(0)

        await page.goto(`/note/${articlePath}`)
        await expect(page.locator('#doc-sidebar')).toHaveCount(0)
        await expect(page.locator('#preview')).toBeVisible()
    })

    test('book edit page lists pages and delete removes item + TOC link', async ({ page, request }) => {
        const bookPath = uniqueBookPath()
        await createBook(request, bookPath, 'Delete UI Book')
        const pageRes = await createBookPage(request, bookPath, 'Delete Me Page')
        const pagePath = pageRes.json.data.path

        await page.goto(`/edit/${bookPath}`)
        const row = page.locator('.book-page-row', { hasText: 'Delete Me Page' })
        await expect(row).toBeVisible()

        await row.locator('[data-act="delete"]').click()
        const confirm = page.locator('.modal-dialog .modal-btn-primary')
        await confirm.waitFor()
        await confirm.click()

        await expect(page.locator('.book-page-row', { hasText: 'Delete Me Page' })).toHaveCount(0)

        const toc = await getBookToc(request, bookPath)
        const paths = (toc.items || []).filter(i => i.path).map(i => i.path)
        expect(paths).not.toContain(pagePath)
    })

    test('legacy saveNote article still works without docType', async ({ page, request }) => {
        const notePath = uniqueNotePath()
        await saveNote(request, notePath, 'Legacy body without docType')
        await page.goto(`/note/${notePath}`)
        await expect(page.locator('#preview')).toContainText('Legacy body without docType')
        await expect(page.locator('#doc-sidebar')).toHaveCount(0)
    })
})

test.describe('create dialog validation', () => {
    test('book create requires path and title in dialog', async ({ page }) => {
        const bookPath = uniqueBookPath()
        await openCreateDialog(page)
        const dialog = page.locator('.modal-create-doc').first()
        await dialog.locator('.type-segment-btn[data-type="book"]').click()
        await dialog.locator('#create-doc-title').fill('Only Title')
        await dialog.locator('#create-doc-ok').click()
        await expect(page.locator('.modal-create-doc').first()).toBeVisible()
        await dialog.locator('#create-doc-path').fill(bookPath)
        await Promise.all([
            page.waitForURL(new RegExp(`/edit/${bookPath}$`)),
            dialog.locator('#create-doc-ok').click(),
        ])
    })
})
