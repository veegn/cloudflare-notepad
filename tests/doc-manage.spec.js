const { test, expect } = require('@playwright/test')
const { uniqueNotePath, createArticle, saveNote, getHomeTree, findTreePath } = require('./helpers')

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
