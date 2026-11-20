import { CONFIG, getI18n } from '../core/config'
import { createModalDialog } from '../core/modal'
import { encodeNotePath } from '../core/pathUtils'

export function normalizeMarkdownLinks(root: HTMLElement): void {
    const { notePath, docType } = CONFIG
    const origin = window.location.origin
    const bookPath = docType === 'book' ? `${encodeNotePath(notePath)}/` : ''
    const base = new URL(`/${bookPath || encodeNotePath(notePath)}`, origin)

    root.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(link => {
        const href = link.getAttribute('href')?.trim()
        if (!href) return

        let target: URL
        try {
            target = new URL(href, bookPath && href.startsWith(bookPath) ? origin : base)
        } catch {
            return
        }

        if (!/^https?:$/.test(target.protocol)) return
        if (target.origin !== origin) {
            link.target = '_blank'
            link.relList.add('noopener', 'noreferrer')
            return
        }

        const relative = !/^(?:[a-z][a-z\d+.-]*:|[/#?])/i.test(href)
        if (docType !== 'article' && relative && /\.md$/i.test(target.pathname)) {
            link.setAttribute('href', `/note${target.pathname}${target.search}${target.hash}`)
        }
    })
}

export function enhanceMarkdownTablesAndTasks(root: HTMLElement): void {
    root.querySelectorAll('table').forEach(table => {
        const container = document.createElement('div')
        container.className = 'md-table-wrap'
        container.tabIndex = 0
        container.setAttribute('role', 'region')
        container.setAttribute('aria-label', table.caption?.textContent?.trim() || getI18n('markdownTable'))
        table.before(container)
        container.append(table)
    })

    root.querySelectorAll('li input[type="checkbox"]').forEach(checkbox => {
        checkbox.closest('li')?.classList.add('md-task-item')
    })
}

function setIntrinsicImageSize(image: HTMLImageElement): void {
    if (!image.naturalWidth || !image.naturalHeight) return
    if (!image.hasAttribute('width')) image.width = image.naturalWidth
    if (!image.hasAttribute('height')) image.height = image.naturalHeight
}

export function enableImageLightbox(image: HTMLImageElement): void {
    if (image.closest('a[href], button')) return

    // An SVG with only a viewBox can collapse in a shrink-to-fit button.
    image.addEventListener('load', () => setIntrinsicImageSize(image), { once: true })
    setIntrinsicImageSize(image)

    const trigger = document.createElement('button')
    trigger.type = 'button'
    trigger.className = 'md-image-trigger'
    const label = getI18n('markdownEnlargeImage')
    trigger.setAttribute('aria-label', image.alt ? `${label} — ${image.alt}` : label)
    image.before(trigger)
    trigger.append(image)

    trigger.addEventListener('click', () => {
        trigger.focus({ preventScroll: true })
        const { dialog, open, close } = createModalDialog<void>({ className: 'md-image-dialog', label }, undefined)
        const dismiss = document.createElement('button')
        dismiss.type = 'button'
        dismiss.className = 'md-image-close'
        dismiss.textContent = '×'
        dismiss.setAttribute('aria-label', getI18n('close'))
        dismiss.addEventListener('click', () => close())
        dismiss.addEventListener('keydown', event => {
            if (event.key === 'Tab') event.preventDefault()
        })

        const fullImage = document.createElement('img')
        fullImage.src = image.currentSrc || image.src
        fullImage.alt = image.alt
        fullImage.decoding = 'async'
        if (image.naturalWidth && image.naturalHeight) {
            fullImage.width = image.naturalWidth
            fullImage.height = image.naturalHeight
        } else {
            fullImage.addEventListener('load', () => setIntrinsicImageSize(fullImage), { once: true })
        }
        const figure = document.createElement('figure')
        figure.append(fullImage)
        if (image.alt) {
            const caption = document.createElement('figcaption')
            caption.textContent = image.alt
            figure.append(caption)
        }

        dialog.append(dismiss, figure)
        open(dismiss)
    })
}

export function addMarkdownHeadingLinks(root: HTMLElement): void {
    const headings = Array.from(root.querySelectorAll<HTMLHeadingElement>('h2, h3'))
    const ids = new Map<string, number>()
    root.querySelectorAll('[id]').forEach(({ id }) => { ids.set(id, (ids.get(id) ?? 0) + 1) })
    const sections = headings.map(heading => {
        const title = heading.textContent?.trim() || getI18n('markdownSection')
        let id = heading.id
        if (!id || ids.get(id) !== 1 || document.getElementById(id) !== heading) {
            const slug = title.normalize('NFKC').toLowerCase()
                .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-').replace(/^-|-$/g, '') || 'section'
            id = slug
            for (let suffix = 2; ids.has(id) || document.getElementById(id); suffix++) {
                id = `${slug}-${suffix}`
            }
            heading.id = id
            ids.set(id, 1)
        }

        const href = `#${encodeURIComponent(id)}`
        const anchor = document.createElement('a')
        anchor.className = 'md-heading-anchor'
        anchor.href = href
        anchor.textContent = '#'
        anchor.setAttribute('aria-label', getI18n('markdownHeadingLink').replace('{title}', title))
        heading.append(' ', anchor)
        return { heading, title, href }
    })

    const reading = root.closest('.composer-frame.is-reading')
    const outline = reading?.querySelector<HTMLElement>('#markdown-outline')
    const list = outline?.querySelector('.md-outline-links')
    const scroll = root.closest<HTMLElement>('.composer-preview-scroll')
    if (!reading || !outline || !list || !scroll || !sections.length) return

    const links = sections.map(({ heading, title, href }) => {
        const link = document.createElement('a')
        link.href = href
        link.textContent = title
        link.classList.toggle('md-outline-subsection', heading.tagName === 'H3')
        return link
    })
    list.textContent = ''
    list.append(...links)
    outline.hidden = false
    reading.classList.add('has-markdown-outline')

    let active: HTMLAnchorElement | undefined
    let frame: number | undefined
    const update = (): void => {
        frame = undefined
        const top = scroll.getBoundingClientRect().top + 48
        let index = 0
        for (const [i, { heading }] of sections.entries()) {
            if (heading.getBoundingClientRect().top > top) break
            index = i
        }
        if (scroll.scrollTop > 0 && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 2) {
            index = links.length - 1
        }
        if (active === links[index]) return
        active?.removeAttribute('aria-current')
        active = links[index]
        active.setAttribute('aria-current', 'location')
        if (outline.clientHeight) active.scrollIntoView({ block: 'nearest' })
    }

    scroll.addEventListener('scroll', () => { frame ??= requestAnimationFrame(update) }, { passive: true })
    requestAnimationFrame(() => {
        // Fragment navigation can run before the Markdown headings are inserted.
        try {
            const id = decodeURIComponent(window.location.hash.slice(1))
            sections.find(({ heading }) => heading.id === id)?.heading.scrollIntoView()
        } catch {
            // A malformed fragment does not affect rendering the document.
        }
        update()
    })
}
