import { expect, test } from '@playwright/test'
import { createBook, createBookPage, saveNote, uniqueBookPath, uniqueNotePath } from './helpers'

test('Markdown highlights common code fences and copies the original code', async ({ page, request }) => {
    const path = uniqueNotePath()
    const javascript = 'const html = "<b>literal</b>";'
    const fences = [
        ['js', javascript],
        ['ts', 'const value: number = 1;'],
        ['rs', 'fn main() {}'],
        ['yml', 'enabled: true'],
        ['sh', 'echo "hello"'],
        ['custom', '  plain source'],
    ]
    const content = fences.map(([language, code]) => `\x60\x60\x60${language}\n${code}\n\x60\x60\x60`).join('\n\n')
    await saveNote(request, path, content)
    await request.patch(`/api/notes/${path}`, { data: { mode: 'md' } })
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
            value: { writeText: async (text: string) => { document.documentElement.dataset.copiedCode = text } },
        })
    })
    await page.goto(`/note/${path}`)

    const blocks = page.locator('.md-code-block')
    await expect(blocks.locator('.md-code-toolbar span')).toHaveText(['JavaScript', 'TypeScript', 'Rust', 'YAML', 'Bash', 'custom'])
    for (let index = 0; index < 5; index++) {
        await expect(blocks.nth(index).locator('code span').first()).toBeVisible()
    }
    await expect(blocks.last().locator('code span')).toHaveCount(0)
    await expect(blocks.first().locator('code b')).toHaveCount(0)
    const copy = blocks.first().getByRole('button', { name: 'Copy code' })
    await copy.click()
    await expect(blocks.first().getByRole('button', { name: 'Copied.' })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-copied-code', `${javascript}\n`)
})

test('mobile Markdown keeps wide tables local and opens images with a caption', async ({ page, request }) => {
    const path = uniqueNotePath()
    const content = [
        '| Column A | Column B | Column C | Column D | Column E | Column F |',
        '| --- | --- | --- | --- | --- | --- |',
        '| One | Two | Three | Four | Five | Six |',
        '| One | Two | Three | Four | Five | Six |',
        '',
        '- [x] Done',
        '- Normal item',
        '',
        '![Example diagram](/favicon.svg)',
        '',
        '[External](https://example.com/docs) · [Same site](/note/other)',
        '\nParagraph spacer.\n'.repeat(175),
        '![Below the fold](/lazy-check.svg)',
    ].join('\n')
    await saveNote(request, path, content)
    await request.patch(`/api/notes/${path}`, { data: { mode: 'md' } })
    await page.setViewportSize({ width: 375, height: 700 })
    let lazyImageRequests = 0
    await page.route('**/lazy-check.svg', route => {
        lazyImageRequests++
        return route.fulfill({
            contentType: 'image/svg+xml',
            body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><rect width="12" height="12"/></svg>',
        })
    })
    await page.goto(`/note/${path}`)

    const table = page.getByRole('region', { name: 'Table' })
    expect(await table.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
    expect(await page.locator('#preview-scroll').evaluate(node => node.scrollWidth === node.clientWidth)).toBe(true)
    await expect(table.locator('thead th').first()).toHaveCSS('font-weight', '650')
    const tableRows = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => getComputedStyle(row).backgroundColor))
    expect(tableRows[0]).not.toBe(tableRows[1])
    await expect(page.locator('.md-task-item')).toHaveCSS('list-style-type', 'none')
    await expect(page.locator('#preview li').last()).toHaveCSS('list-style-type', 'disc')
    const external = page.getByRole('link', { name: 'External' })
    await expect(external).toHaveAttribute('target', '_blank')
    await expect(external).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(page.getByRole('link', { name: 'Same site' })).not.toHaveAttribute('target', '_blank')

    const trigger = page.getByRole('button', { name: 'Enlarge image — Example diagram' })
    const image = trigger.locator('img')
    await expect(image).toHaveAttribute('loading', 'lazy')
    await expect(image).toHaveAttribute('decoding', 'async')
    await trigger.click()
    const lightbox = page.getByRole('dialog', { name: 'Enlarge image' })
    await expect(lightbox.getByRole('img', { name: 'Example diagram' })).toBeVisible()
    await expect(lightbox.locator('figcaption')).toHaveText('Example diagram')
    await expect(lightbox.getByRole('button', { name: 'Close' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(lightbox).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await trigger.click()
    await page.locator('.modal-overlay').click({ position: { x: 2, y: 2 } })
    await expect(lightbox).toHaveCount(0)
    expect(lazyImageRequests).toBe(0)
    await page.locator('#preview-scroll').evaluate(scroll => { scroll.scrollTop = scroll.scrollHeight })
    const lazyImage = page.getByRole('img', { name: 'Below the fold' })
    await expect.poll(() => lazyImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
    await lazyImage.scrollIntoViewIfNeeded()
    await expect(lazyImage).toBeInViewport()
    expect(lazyImageRequests).toBe(1)
})

test('Markdown heading deep links and outline track the reading scroll', async ({ page, request }) => {
    const path = uniqueNotePath()
    const filler = '\n\nA paragraph between sections.'.repeat(25)
    await saveNote(request, path, `# Document\n\n## 安装${filler}\n\n### Details${filler}\n\n## 安装${filler}`)
    await request.patch(`/api/notes/${path}`, { data: { mode: 'md' } })
    await page.goto(`/note/${path}#${encodeURIComponent('安装-2')}`)

    const outline = page.getByRole('navigation', { name: 'On this page' })
    const sections = outline.getByRole('link')
    await expect(sections).toHaveText(['安装', 'Details', '安装'])
    await expect(sections.last()).toHaveAttribute('aria-current', 'location')
    const firstSection = page.locator('#preview h2').first()
    const secondInstallation = page.locator('#preview h2').last()
    await expect(firstSection).toHaveAttribute('id', '安装')
    await expect(secondInstallation).toHaveAttribute('id', '安装-2')
    await expect(secondInstallation).toBeInViewport()

    await sections.first().click()
    await expect(page).toHaveURL(`/note/${path}#${encodeURIComponent('安装')}`)
    await expect(sections.first()).toHaveAttribute('aria-current', 'location')
    const subheading = page.locator('#preview #details')
    await subheading.evaluate(heading => heading.scrollIntoView())
    await expect(sections.nth(1)).toHaveAttribute('aria-current', 'location')
    await expect(subheading.getByRole('link', { name: 'Link to Details' })).toHaveAttribute('href', '#details')
    await page.setViewportSize({ width: 375, height: 700 })
    await expect(outline).toBeHidden()
})

test('mobile Mermaid uses a placeholder and keeps wide diagrams scrollable', async ({ page, request }) => {
    const path = uniqueNotePath()
    const source = 'flowchart LR\nA[First stage] --> B[Second stage] --> C[Third stage] --> D[Fourth stage] --> E[Last stage]'
    await saveNote(request, path, '```mermaid\n' + source + '\n```')
    await request.patch(`/api/notes/${path}`, { data: { mode: 'md' } })
    await page.setViewportSize({ width: 375, height: 700 })

    let releaseLibrary!: () => void
    const libraryReady = new Promise<void>(resolve => { releaseLibrary = resolve })
    await page.route(url => url.pathname === '/js/mermaid.min.js', async route => {
        await libraryReady
        await route.continue()
    })
    const diagram = page.getByRole('region', { name: 'Diagram' })
    try {
        await page.goto(`/note/${path}`, { waitUntil: 'domcontentloaded' })
        await expect(diagram.getByText('Loading diagram…')).toBeVisible()
        await expect(diagram.locator('.mermaid-source')).toBeHidden()
    } finally {
        releaseLibrary()
    }
    await expect(diagram.locator('svg .node')).toHaveCount(5, { timeout: 15000 })
    await expect(diagram.getByText('Loading diagram…')).toHaveCount(0)
    expect(await diagram.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true)
    expect(await page.locator('#preview-scroll').evaluate(node => node.scrollWidth === node.clientWidth)).toBe(true)
})

test('book chapter links reuse the TOC and open both Markdown export path formats', async ({ page, request }) => {
    const book = uniqueBookPath()
    const intro = `${book}/intro`
    const setup = `${book}/setup`
    const reference = `${book}/reference.md`
    await createBook(request, book, 'Reading Book')
    await createBookPage(request, book, 'Introduction', intro)
    await createBookPage(request, book, 'Setup', setup)
    await createBookPage(request, book, 'Reference', reference)
    await saveNote(request, intro, '# Introduction\n\n[Setup steps](./setup.md#steps)')
    await saveNote(request, setup, '# Setup\n\n## Steps\n\n[Reference export](reference.md)')
    await saveNote(request, reference, '# Reference\n\nExact suffixed document.')

    let tocRequests = 0
    page.on('request', req => {
        if (new URL(req.url()).pathname === '/api/toc') tocRequests++
    })
    await page.goto(`/note/${intro}`)
    const navigation = page.getByRole('navigation', { name: 'Chapter navigation' })
    await expect(navigation.locator('a[rel="prev"]')).toHaveCount(0)
    await expect(navigation.locator('a[rel="next"]')).toHaveAttribute('href', `/note/${setup}`)
    const setupLink = page.getByRole('link', { name: 'Setup steps' })
    await expect(setupLink).toHaveAttribute('href', `/note/${setup}.md#steps`)
    await setupLink.click()
    await expect(page.locator('#preview #steps')).toContainText('Steps')
    await expect(navigation.locator('a[rel="prev"]')).toHaveAttribute('href', `/note/${intro}`)
    await expect(navigation.locator('a[rel="next"]')).toHaveAttribute('href', `/note/${reference}`)
    await page.getByRole('link', { name: 'Reference export' }).click()
    await expect(page.locator('#preview')).toContainText('Exact suffixed document.')
    await expect(navigation.locator('a[rel="next"]')).toHaveCount(0)
    await navigation.locator('a[rel="prev"]').click()
    await expect(page).toHaveURL(`/note/${setup}`)
    expect(tocRequests).toBe(1)

    const protectedSetup = await request.patch(`/api/notes/${setup}`, { data: { password: 'reading-test-password' } })
    expect(protectedSetup.ok()).toBe(true)
    await page.goto(`/note/${setup}.md#steps`)
    await expect(page.locator('#note-password')).toBeVisible()
    await expect(page.locator('#preview')).toHaveCount(0)
})
