const { test, expect } = require('@playwright/test')
const { saveNote, uniqueNotePath } = require('./helpers')

test('create route redirects to a random edit path', async ({ request }) => {
    const response = await request.get('/new', {
        maxRedirects: 0,
    })

    expect(response.status()).toBe(302)
    expect(response.headers().location).toMatch(/^\/edit\/[a-z0-9]{5}$/)
})

test('public note view renders saved content', async ({ page, request }) => {
    const notePath = uniqueNotePath()
    await saveNote(request, notePath, 'Shared note body')

    await page.goto(`/note/${notePath}`)

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

    await page.goto(`/note/${notePath}`)

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

    await page.goto(`/note/${notePath}`)

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
    await request.patch(`/api/notes/${notePath}`, {
        data: { mode: 'json' },
    })

    await page.goto(`/note/${notePath}`)

    await expect(page.locator('.code-viewer')).toBeVisible()
    await expect(page.locator('.code-viewer-line-no').first()).toHaveText('1')
    await expect(page.locator('.token-key').first()).toHaveText('"name"')
    await expect(page.locator('.token-boolean')).toContainText('true')
})

test('public raw route returns note content', async ({ request }) => {
    const notePath = uniqueNotePath()
    await saveNote(request, notePath, 'raw content body')

    const response = await request.get(`/api/notes/${notePath}?raw=1`)

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

test('clicking theme toggle switches data-theme attribute and persists in localStorage', async ({ page }) => {
    await page.goto('/')

    // Reset/remove localStorage theme to start from fresh
    await page.evaluate(() => localStorage.removeItem('theme'))
    await page.goto('/')

    const htmlThemeBefore = await page.locator('html').getAttribute('data-theme')

    // Click the theme toggle button in the statusbar
    await page.locator('.theme-toggle').click()

    const htmlThemeAfter = await page.locator('html').getAttribute('data-theme')
    expect(htmlThemeAfter).not.toBe(htmlThemeBefore)

    // Check persistence in localStorage
    const savedTheme = await page.evaluate(() => localStorage.getItem('theme'))
    expect(savedTheme).toBe(htmlThemeAfter)

    // Click again to toggle back
    await page.locator('.theme-toggle').click()
    const htmlThemeFinal = await page.locator('html').getAttribute('data-theme')
    expect(htmlThemeFinal).toBe(htmlThemeBefore)
})

test('clicking share button copies the note URL to clipboard and shows toast', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    // Click the share button in footer
    await page.locator('.opt-share').click()

    // Verify toast message appears
    await expect(page.locator('body')).toContainText('Share link copied.')

    // Verify clipboard content contains the sharing link
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboardText).toContain(`/note/${notePath}`)
})

test('readonly yaml view highlights comments and strings correctly without corruption', async ({ page, request }) => {
    const notePath = uniqueNotePath()

    // Save note with a YAML string containing a hash (#), unquoted keys, and quoted inline keys
    const yamlContent = 'fallback: ["https://example.com/dns-query #h3=true"] # comment here\nproxies:\n  - {"name": "us", "server": "cloud"}'
    await saveNote(request, notePath, yamlContent)

    // Patch mode to yaml
    await request.patch(`/api/notes/${notePath}`, {
        data: { mode: 'yaml' },
    })

    await page.goto(`/note/${notePath}`)

    // Verify code viewer is mounted
    await expect(page.locator('.code-viewer')).toBeVisible()

    // Verify string is highlighted correctly (and contains the hash without breaking)
    await expect(page.locator('.token-string').first()).toHaveText('"https://example.com/dns-query #h3=true"')

    // Verify comment is highlighted correctly
    await expect(page.locator('.token-comment').first()).toHaveText('# comment here')

    // Verify keys are highlighted correctly (both unquoted and quoted)
    const keys = page.locator('.token-key')
    await expect(keys.nth(0)).toHaveText('fallback')
    await expect(keys.nth(1)).toHaveText('proxies')
    await expect(keys.nth(2)).toHaveText('"name"')
    await expect(keys.nth(3)).toHaveText('"server"')

    // Verify there is no raw marker leakage
    const bodyText = await page.locator('.code-viewer').textContent()
    expect(bodyText).not.toContain('%%SCNTOKEN')
})

test('visiting invalid page and dismissing confirm dialog stays on 404', async ({ page }) => {
    // Dismiss confirm dialog
    page.once('dialog', dialog => dialog.dismiss())

    await page.goto('/my-invalid-test-path')
    await expect(page.locator('.editor-banner')).toContainText('404')
    expect(page.url()).toContain('/my-invalid-test-path')
})

test('visiting invalid page and accepting confirm dialog redirects to note view', async ({ page }) => {
    // Accept confirm dialog
    page.once('dialog', dialog => dialog.accept())

    await page.goto('/my-invalid-test-path')
    await page.waitForURL('**/note/my-invalid-test-path')
    expect(page.url()).toContain('/note/my-invalid-test-path')
})
