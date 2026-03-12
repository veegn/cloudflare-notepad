const { test, expect } = require('@playwright/test')
const { saveNote, uniqueNotePath } = require('./helpers')

test('create route redirects to a random edit path', async ({ request }) => {
    const response = await request.get('/.create', {
        maxRedirects: 0,
    })

    expect(response.status()).toBe(302)
    expect(response.headers().location).toMatch(/^\/[a-z0-9]{5}\/edit$/)
})

test('public note view renders saved content', async ({ page, request }) => {
    const notePath = uniqueNotePath()
    await saveNote(request, notePath, 'Shared note body')

    await page.goto(notePath)

    await expect(page.locator('#preview')).toContainText('Shared note body')
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible()

    const frameBox = await page.locator('.composer-frame').boundingBox()
    const previewBox = await page.locator('#preview').boundingBox()

    expect(frameBox).not.toBeNull()
    expect(previewBox).not.toBeNull()
    expect(previewBox.width).toBeGreaterThan(frameBox.width * 0.75)
})

test('long note content does not overlap the bottom status actions', async ({ page, request }) => {
    const notePath = uniqueNotePath()
    const longContent = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join('\n')
    await saveNote(request, notePath, longContent)

    await page.goto(notePath)

    const editorPaneBox = await page.locator('.editor-pane').boundingBox()
    const statusbarBox = await page.locator('.statusbar').boundingBox()
    const editButtonBox = await page.getByRole('button', { name: 'Edit' }).boundingBox()

    expect(editorPaneBox).not.toBeNull()
    expect(statusbarBox).not.toBeNull()
    expect(editButtonBox).not.toBeNull()
    expect(statusbarBox.y).toBeGreaterThanOrEqual(editorPaneBox.y + editorPaneBox.height - 1)
    expect(editButtonBox.y).toBeGreaterThanOrEqual(statusbarBox.y)

    const scrollMetrics = await page.locator('#preview-scroll').evaluate(node => ({
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        overflowY: getComputedStyle(node).overflowY,
    }))

    expect(scrollMetrics.overflowY).toBe('auto')
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)
})

test('tab bar stays visually pinned while long content scrolls', async ({ page, request }) => {
    const notePath = uniqueNotePath()
    const longContent = Array.from({ length: 140 }, (_, index) => `block ${index + 1}`).join('\n')
    await saveNote(request, notePath, longContent)

    await page.goto(notePath)

    const tabbar = page.locator('.editor-tabbar')
    const before = await tabbar.boundingBox()

    await page.locator('#preview-scroll').evaluate(node => {
        node.scrollTop = node.scrollHeight
        node.dispatchEvent(new Event('scroll'))
    })

    const after = await tabbar.boundingBox()

    expect(before).not.toBeNull()
    expect(after).not.toBeNull()
    expect(Math.abs(before.y - after.y)).toBeLessThan(1)
})

test('readonly json view uses a denser code viewer layout', async ({ page, request }) => {
    const notePath = uniqueNotePath()
    await saveNote(request, notePath, '{\n  "name": "cloud",\n  "enabled": true\n}')
    await request.post(`${notePath}/edit/setting`, {
        data: { mode: 'json' },
    })

    await page.goto(notePath)

    await expect(page.locator('.code-viewer')).toBeVisible()
    await expect(page.locator('.code-viewer-line-no').first()).toHaveText('1')
    await expect(page.locator('.token-key').first()).toHaveText('"name"')
    await expect(page.locator('.token-boolean')).toContainText('true')
})

test('public raw route returns note content', async ({ request }) => {
    const notePath = uniqueNotePath()
    await saveNote(request, notePath, 'raw content body')

    const response = await request.get(`${notePath}/raw`)

    expect(response.status()).toBe(200)
    await expect(response.text()).resolves.toContain('raw content body')
})

test('home page localizes copy, removes quick start, and renders home note markdown', async ({ page, request }) => {
    const localizedHome = await request.get('/', {
        headers: {
            'Accept-Language': 'zh-CN,zh;q=0.9',
        },
    })
    const localizedHtml = await localizedHome.text()

    expect(localizedHtml).toContain('一个轻量的工作台，用于快速记录与安全分享。')

    await page.goto('/')
    await expect(page.getByText('Quick Start')).toHaveCount(0)
    await expect(page.locator('#preview-home h2, #preview-home h3').first()).toBeVisible()
    await expect(page.locator('#preview-home li').first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Edit Home' })).toBeVisible()
})
