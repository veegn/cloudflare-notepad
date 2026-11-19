import { test, expect } from '@playwright/test'
import { uniqueNotePath, uniqueBookPath, createArticle, createBook, saveNote, getHomeTree, findTreePath } from './helpers'

test('home list shows title as primary text and path as subtitle', async ({ page, request }) => {
    const notePath = uniqueNotePath()
    const title = `Title ${notePath}`
    await createArticle(request, notePath, title)

    await page.goto('/')
    await page.locator('.doc-tree-row', { hasText: title }).first().waitFor()

    const row = page.locator('.doc-tree-row').filter({ hasText: title }).first()
    await expect(row.locator('.doc-tree-title')).toHaveText(title)
    await expect(row.locator('.doc-tree-path')).toContainText(notePath)
})

test('mobile library keeps book titles readable and exposes repair in a touch-sized menu', async ({ page, request }) => {
    const path = uniqueBookPath()
    const title = 'Cloudflare 笔记手册'
    await createBook(request, path, title)
    await createArticle(request, `${uniqueNotePath()}/chapter`)
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    const search = page.locator('#home-search')
    await expect(search).toHaveCSS('font-size', '16px')
    for (const control of [search, page.locator('.home-chip').first(), page.locator('.home-tool-btn').first(),
        page.locator('button.doc-tree-chevron').first()]) {
        const box = await control.boundingBox()
        expect(box?.width).toBeGreaterThanOrEqual(44)
        expect(box?.height).toBeGreaterThanOrEqual(44)
    }

    await search.fill(title)
    const row = page.locator(`[data-path="${path}"]`)
    const bookTitle = row.locator('.doc-tree-title')
    await expect(bookTitle).toHaveText(title)
    expect(await bookTitle.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    const more = row.getByRole('button', { name: 'More actions' })
    const moreBox = await more.boundingBox()
    expect(moreBox?.width).toBeGreaterThanOrEqual(44)
    expect(moreBox?.height).toBeGreaterThanOrEqual(44)
    await more.click()
    const repair = page.getByRole('menuitem', { name: 'Repair', exact: true })
    await expect(repair).toHaveCSS('min-height', '44px')
    await repair.click()
    const repairConfirm = page.locator('.modal-dialog')
    await expect(repairConfirm).toContainText(path)
    await repairConfirm.getByRole('button', { name: 'Cancel' }).click()
    await expect(repairConfirm).toBeHidden()

    await page.locator('#btn-new-doc').click()
    const titleInput = page.locator('#create-doc-title')
    await expect(titleInput).toHaveCSS('font-size', '16px')
    await expect(titleInput).toHaveCSS('min-height', '44px')
})

test('list row more menu offers rename, copy link, and delete with confirm', async ({ page, request }) => {
    const notePath = uniqueNotePath()
    await createArticle(request, notePath, `Menu ${notePath}`)

    await page.goto('/')
    const row = page.locator('.doc-tree-row').filter({ hasText: notePath }).first()
    await row.hover()
    await row.locator('.doc-tree-more').click()

    const menu = page.locator('.doc-actions-menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Rename' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Copy link' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Delete' })).toBeVisible()

    // Delete requires a second confirmation
    await menu.getByRole('menuitem', { name: 'Delete' }).click()
    await expect(page.locator('.modal-dialog')).toBeVisible()
    await expect(page.locator('.modal-dialog')).toContainText(notePath)
    await page.locator('.modal-btn-secondary').click()
    await expect(page.locator('.modal-dialog')).toBeHidden()

    // Still present after cancel
    const tree = await getHomeTree(request)
    expect(findTreePath(tree.tree, notePath)).toBeTruthy()
})

test('raw opens in-app modal instead of navigating to bare API', async ({ page, request }) => {
    const notePath = uniqueNotePath()
    await saveNote(request, notePath, 'raw body content')
    await page.goto(`/note/${notePath}`)

    await page.locator('.opt-raw').click()
    await expect(page.locator('.raw-viewer')).toBeVisible()
    await expect(page.locator('#raw-body')).toContainText('raw body content')
    expect(page.url()).toContain(`/note/${notePath}`)

    await page.locator('#raw-close').click()
    await expect(page.locator('.raw-viewer')).toBeHidden()
})

test('Raw selects source text when clipboard access is unavailable', async ({ page, request }) => {
    const path = uniqueNotePath()
    const source = 'Raw source\nwith more than one line'
    await saveNote(request, path, source)
    await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined }))

    await page.goto(`/note/${path}`)
    await page.locator('.opt-raw').click()
    await page.locator('#raw-copy').click()

    await expect(page.locator('.toast-message')).toHaveText('Copy the source text manually')
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(source)
})

test('home footer does not expose edit/raw that would hit _index', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.opt-raw')).toHaveCount(0)
    await expect(page.locator('.opt-edit')).toHaveCount(0)
    await expect(page.locator('.opt-share')).toHaveCount(0)
})

test('share panel toggle updates public/private status', async ({ page, request }) => {
    const notePath = uniqueNotePath()
    await createArticle(request, notePath, `Share ${notePath}`)
    await page.goto(`/edit/${notePath}`)

    await page.locator('.opt-share').click()
    await expect(page.locator('.share-panel')).toBeVisible()
    await expect(page.locator('#share-status')).toContainText(/Public/i)

    await page.locator('#share-toggle').click()
    await expect(page.locator('#share-status')).toContainText(/Private/i)
    await expect(page.locator('body')).toContainText(/Now private/i)
    // Panel stays open after toggle
    await expect(page.locator('.share-panel')).toBeVisible()
})
