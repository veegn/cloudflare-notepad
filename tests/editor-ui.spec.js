const { test, expect } = require('@playwright/test')
const { fillCodeEditor, readCodeEditor, switchMode, uniqueNotePath } = require('./helpers')

test('plain editor mounts CodeMirror and highlights keywords while typing', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    const editor = page.locator('.cm-editor')
    const gutter = page.locator('.cm-lineNumbers')

    await fillCodeEditor(page, 'alpha\nbeta\nTODO item')

    await expect(editor).toContainText('alpha')
    await expect(editor).toContainText('beta')
    await expect(page.locator('.cm-keyword-highlight')).toContainText('TODO')
    await expect(gutter).toContainText('3')
})

test('format picker switches to json mode and mounts CodeMirror', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'json')

    const composer = page.locator('.composer-frame')
    const editor = page.locator('.cm-editor')

    await expect(composer).toHaveAttribute('data-mode', 'json')
    await fillCodeEditor(page, '{\n  "name": "cloud",\n  "enabled": true\n}')
    await expect(editor).toContainText('"name"')
    await expect(editor).toContainText('"enabled"')
    await expect(editor).toContainText('"cloud"')
    await expect(editor).toContainText('true')
})

test('markdown editor renders in split view with live preview', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'md')

    const composer = page.locator('.composer-frame')
    const preview = page.locator('#preview')
    const editorPane = page.locator('.composer-editor-pane')
    const previewPane = page.locator('.composer-preview-pane')

    await expect(composer).toHaveAttribute('data-mode', 'md')
    await fillCodeEditor(page, '# Heading\n\n- item one\n- item two\n\nIMPORTANT note')

    await expect(editorPane).toBeVisible()
    await expect(previewPane).toBeVisible()
    await expect(preview.locator('h1')).toContainText('Heading')
    await expect(preview.locator('li')).toHaveCount(2)
    await expect(preview.locator('.keyword-highlight')).toContainText('IMPORTANT')
})

test('markdown editor keeps editor and preview columns aligned in split view', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'md')

    const preview = page.locator('#preview')

    await fillCodeEditor(page, '# Title\n\nParagraph text\n\n> quote')

    const editorPaneBox = await page.locator('.composer-editor-pane').boundingBox()
    const previewPaneBox = await page.locator('.composer-preview-pane').boundingBox()
    const previewHeadingBox = await preview.locator('h1').boundingBox()

    expect(editorPaneBox).not.toBeNull()
    expect(previewPaneBox).not.toBeNull()
    expect(previewHeadingBox).not.toBeNull()
    expect(editorPaneBox.width).toBeGreaterThan(200)
    expect(previewPaneBox.width).toBeGreaterThan(200)
    expect(previewHeadingBox.x).toBeGreaterThanOrEqual(previewPaneBox.x)
    await expect(preview.locator('h1')).toHaveText('Title')

    const previewScrollLeft = await page.locator('#preview-scroll').evaluate(node => node.scrollLeft)
    expect(previewScrollLeft).toBe(0)
})

test('markdown editor keeps raw text readable while the preview stays in a separate pane', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'md')
    await fillCodeEditor(page, '# Heading\n\nParagraph')

    const lineColor = await page.locator('.cm-line').first().evaluate(node => getComputedStyle(node).color)
    const previewHeading = page.locator('#preview h1')

    expect(lineColor).not.toBe('rgba(0, 0, 0, 0)')
    await expect(previewHeading).toHaveText('Heading')
})

test('markdown preview uses tighter typography spacing', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'md')
    await fillCodeEditor(page, '# Heading\n\nParagraph text\n\n## Subheading\n\nMore text')

    const previewMetrics = await page.locator('#preview').evaluate(node => {
        const styles = getComputedStyle(node)
        const heading = node.querySelector('h1')
        const paragraph = node.querySelector('p')
        const subheading = node.querySelector('h2')
        return {
            lineHeight: parseFloat(styles.lineHeight),
            fontSize: parseFloat(styles.fontSize),
            headingMarginBottom: heading ? parseFloat(getComputedStyle(heading).marginBottom) : 0,
            paragraphMarginTop: paragraph ? parseFloat(getComputedStyle(paragraph).marginTop) : 0,
            subheadingMarginTop: subheading ? parseFloat(getComputedStyle(subheading).marginTop) : 0,
        }
    })

    expect(previewMetrics.lineHeight).toBeLessThan(24)
    expect(previewMetrics.fontSize).toBe(16)
    expect(previewMetrics.headingMarginBottom).toBeLessThan(4)
    expect(previewMetrics.paragraphMarginTop).toBeLessThan(6)
    expect(previewMetrics.subheadingMarginTop).toBeLessThan(12)
})

test('markdown editor keeps markdown markers in the editor pane', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'md')
    await fillCodeEditor(page, '# Heading\n\nParagraph')

    const firstLineText = await page.locator('.cm-line').first().textContent()

    expect(firstLineText).toContain('# Heading')
})

test('markdown editor can switch between edit, split, and preview layouts', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'md')

    const composer = page.locator('.composer-frame')
    await page.locator('.md-layout-button[data-layout="edit"]').click()
    await expect(composer).toHaveClass(/md-layout-edit/)

    await page.locator('.md-layout-button[data-layout="preview"]').click()
    await expect(composer).toHaveClass(/md-layout-preview/)

    await page.locator('.md-layout-button[data-layout="split"]').click()
    await expect(composer).toHaveClass(/md-layout-split/)
})

test('format now prettifies json content in place', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'json')

    await fillCodeEditor(page, '{"name":"cloud","enabled":true,"count":1}')
    await page.locator('#format-trigger').click()

    await expect.poll(() => readCodeEditor(page)).toBe('{\n  "name": "cloud",\n  "enabled": true,\n  "count": 1\n}\n')
})

test('format shortcut prettifies json content in place', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'json')

    await fillCodeEditor(page, '{"items":[1,2],"ok":true}')
    await page.keyboard.press('Control+Shift+F')

    await expect.poll(() => readCodeEditor(page)).toBe('{\n  "items": [\n    1,\n    2\n  ],\n  "ok": true\n}\n')
})

test('format now shows an error and keeps invalid json content intact', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'json')

    await fillCodeEditor(page, '{"name": }')
    await page.locator('#format-trigger').click()

    await expect(page.getByText(/Formatting failed\./)).toBeVisible()
    await expect.poll(() => readCodeEditor(page)).toBe('{"name": }')
})

test('format now prettifies yaml content in place', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'yaml')

    await fillCodeEditor(page, 'name: cloud\nenabled: true\nitems: [1,2]')
    await page.locator('#format-trigger').click()

    await expect.poll(() => readCodeEditor(page)).toBe('name: cloud\nenabled: true\nitems:\n  - 1\n  - 2\n')
})

test('format shortcut prettifies yaml content in place', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'yaml')

    await fillCodeEditor(page, 'title: cloud\nactive: false')
    await page.keyboard.press('Control+Shift+F')

    await expect.poll(() => readCodeEditor(page)).toBe('title: cloud\nactive: false\n')
})

test('format now shows an error and keeps invalid yaml content intact', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'yaml')

    await fillCodeEditor(page, 'name: [invalid')
    await page.locator('#format-trigger').click()

    await expect(page.getByText(/Formatting failed\./)).toBeVisible()
    await expect.poll(() => readCodeEditor(page)).toBe('name: [invalid')
})

test('exit button redirects user from edit view to readonly view', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    // Click the exit button
    await page.locator('.opt-exit').click()

    // Wait for redirection to the readonly note view
    await page.waitForURL(`**/note/${notePath}`)
    await expect(page.locator('.opt-edit')).toBeVisible()
})
