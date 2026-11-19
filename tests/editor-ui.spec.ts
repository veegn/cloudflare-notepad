import assert from 'node:assert/strict'
import { test, expect } from '@playwright/test'
import { formatTextByMode } from '../frontend/editor/formatters'
import { fillCodeEditor, readCodeEditor, saveNote, switchMode, uniqueNotePath } from './helpers'

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

test('small-screen status bar fits all actions and keeps the format menu above it', async ({ page, request }) => {
    const path = uniqueNotePath()
    const password = 'small-screen-test'
    await saveNote(request, path, '# Small screen')
    await request.patch(`/api/notes/${path}`, { data: { mode: 'md' } })
    await request.patch(`/api/notes/${path}`, { data: { password } })
    await page.request.post('/api/auth', { data: { path, password } })

    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto(`/edit/${path}`)
    const bar = page.locator('.statusbar')
    const trigger = bar.locator('#mode-trigger')
    await expect(trigger).toHaveText('Format: Markdown')
    await expect(bar.getByRole('button', { name: 'Change Password' })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Exit' })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Share' })).toHaveCSS('white-space', 'nowrap')
    await expect(bar.getByRole('button', { name: 'Image' })).toHaveCount(0)
    await expect(page.locator('#btn-upload-image-md')).toBeVisible()

    const layout = await bar.evaluate(element => {
        const bounds = element.getBoundingClientRect()
        const editor = document.querySelector('.editor-pane')!.getBoundingClientRect()
        const clipped = Array.from(element.querySelectorAll<HTMLElement>('button, a'))
            .filter(control => control.getClientRects().length > 0)
            .filter(control => {
                const box = control.getBoundingClientRect()
                return box.width < 44 || box.height < 44 || box.left < 0 || box.right > innerWidth ||
                    box.top < bounds.top || box.bottom > bounds.bottom
            })
            .map(control => control.textContent?.trim() || control.title)
        return {
            overflow: element.scrollWidth > element.clientWidth,
            editorOverlaps: editor.bottom > bounds.top + 1,
            clipped,
        }
    })
    expect(layout).toEqual({ overflow: false, editorOverlaps: false, clipped: [] })

    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const menu = page.locator('#mode-menu')
    await expect(menu).toBeVisible()
    for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 736, height: 414 }]) {
        await page.setViewportSize(viewport)
        const barBox = await bar.boundingBox()
        const menuBox = await menu.boundingBox()
        assert.ok(barBox && menuBox)
        expect(barBox.width).toBeLessThanOrEqual(viewport.width)
        expect(menuBox.y).toBeGreaterThanOrEqual(0)
        expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(viewport.width)
        expect(menuBox.y + menuBox.height).toBeLessThan(barBox.y)
        if (viewport.width === 568) {
            expect(barBox.height).toBeLessThan(50)
            const editorBox = await page.locator('#cm-editor').boundingBox()
            expect(editorBox?.height).toBeGreaterThan(viewport.height / 2)
        }
    }

    await menu.getByRole('button', { name: /^YAML/ }).click()
    await expect(trigger).toHaveText('Format: YAML')
    await bar.getByRole('button', { name: 'Exit' }).click()
    await expect(page).toHaveURL(`/note/${path}`)
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

    assert.ok(editorPaneBox)
    assert.ok(previewPaneBox)
    assert.ok(previewHeadingBox)
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

test('narrow markdown editor defaults to Edit and restores supported layout preferences', async ({ page, request }) => {
    const path = uniqueNotePath()
    await saveNote(request, path, '# Mobile preview')
    await request.patch(`/api/notes/${path}`, { data: { mode: 'md' } })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto(`/edit/${path}`)

    const edit = page.getByRole('button', { name: 'Edit', exact: true })
    const preview = page.getByRole('button', { name: 'Preview', exact: true })
    const split = page.locator('.md-layout-button[data-layout="split"]')
    await expect(edit).toHaveAttribute('aria-pressed', 'true')
    await expect(preview).toHaveAttribute('aria-pressed', 'false')
    await expect(split).toBeHidden()
    await expect(page.locator('#preview')).toBeHidden()
    for (const button of [edit, preview]) {
        const box = await button.boundingBox()
        expect(box?.width).toBeGreaterThanOrEqual(44)
        expect(box?.height).toBeGreaterThanOrEqual(44)
    }
    const image = page.locator('#btn-upload-image-md')
    const toolbarColor = await page.locator('.composer-editor-toolbar').evaluate(el => getComputedStyle(el).color)
    await expect(image).toHaveCSS('color', toolbarColor)

    await preview.click()
    await expect(page.locator('#preview h1')).toHaveText('Mobile preview')
    await page.reload()
    await expect(preview).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#cm-editor')).toBeHidden()

    await page.setViewportSize({ width: 1024, height: 768 })
    await split.click()
    await expect(split).toHaveAttribute('aria-pressed', 'true')
    await page.setViewportSize({ width: 320, height: 568 })
    await expect(edit).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('#preview')).toBeHidden()
    await page.reload()
    await expect(edit).toHaveAttribute('aria-pressed', 'true')
    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(split).toHaveAttribute('aria-pressed', 'true')
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

test('yaml formatting resolves merges and preserves legacy numeric scalars', () => {
    expect(formatTextByMode('yaml', '# comment\n')).toBe('null\n')
    expect(formatTextByMode('yaml', 'binary: 0b1010\nthousands: 1_000\n')).toBe('binary: 10\nthousands: 1_000\n')
    const yaml = 'defaults: &defaults\n  enabled: true\nnote:\n  <<: *defaults\n  title: test\n'
    expect(formatTextByMode('yaml', yaml)).toBe('defaults:\n  enabled: true\nnote:\n  enabled: true\n  title: test\n')
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

test('markdown editor renders mermaid diagrams', async ({ page }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    await switchMode(page, 'md')
    await fillCodeEditor(page, '```mermaid\ngraph TD\nA-->B\n```')

    const mermaidDiv = page.locator('.composer-preview-pane .mermaid')
    await expect(mermaidDiv).toBeVisible()
    await expect(mermaidDiv.locator('svg .node')).toHaveCount(2, { timeout: 15000 })
    await expect(mermaidDiv).not.toHaveClass(/mermaid-source/)
})
