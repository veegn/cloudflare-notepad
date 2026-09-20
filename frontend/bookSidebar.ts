import { getI18n } from './config'
import type { BookPageItem, TocItem } from './types'
import { showPrompt, showConfirm, showToast, errHandle } from './ui'
import { anchor, el, encodeNotePath, escapeHtml } from './pathUtils'

function bookPathFromSidebar(node: HTMLElement): string {
    if (node.dataset.docType === 'book') return node.dataset.notePath || ''
    return node.dataset.bookRef || ''
}

async function fetchToc(book: string): Promise<TocItem[]> {
    const res = await fetch(`/api/toc?book=${encodeURIComponent(book)}`)
    const json = (await res.json()) as {
        code: number
        message?: string
        data?: { items?: TocItem[] }
    }
    if (json.code !== 0) throw new Error(json.message || 'toc failed')
    return json.data?.items || []
}

async function fetchPages(book: string): Promise<{ title: string; items: BookPageItem[] }> {
    const res = await fetch(`/api/books/${encodeNotePath(book)}/pages`)
    const json = (await res.json()) as {
        code: number
        message?: string
        data?: { book?: { title?: string }; items?: BookPageItem[] }
    }
    if (json.code !== 0) throw new Error(json.message || 'pages failed')
    return { title: json.data?.book?.title || book, items: json.data?.items || [] }
}

/** Generic section labels that add noise in a book TOC sidebar. */
function isNoiseHeading(title: string): boolean {
    return /^(toc|contents|目录|目录导航|table of contents)$/i.test(title.trim())
}

function renderTocSidebar(body: HTMLElement, items: TocItem[], currentPath: string): void {
    body.innerHTML = ''
    const navItems = items.filter(i => !i.heading && i.path)
    const headings = items.filter(i => i.heading && !isNoiseHeading(i.title))

    if (navItems.length === 0 && headings.length === 0) {
        body.innerHTML = `<div class="doc-tree-empty-hint">${getI18n('bookEmptyToc')}</div>`
        return
    }

    body.classList.add('doc-toc-list')
    let pageNo = 0
    for (const item of items) {
        if (item.heading) {
            if (isNoiseHeading(item.title)) continue
            const node = document.createElement('div')
            node.className = 'doc-toc-heading'
            node.textContent = item.title
            body.appendChild(node)
            continue
        }

        pageNo += 1
        const active = item.path === currentPath
        const node = document.createElement('div')
        node.className = `doc-toc-item${active ? ' is-active' : ''}${item.exists ? '' : ' is-dead'}`
        node.style.setProperty('--toc-depth', String(item.depth || 0))
        if (item.title) node.title = item.title

        const lock = item.protected ? `<span class="doc-toc-lock" aria-hidden="true">🔒</span>` : ''
        node.innerHTML = `
          <span class="doc-toc-num" aria-hidden="true">${String(pageNo).padStart(2, '0')}</span>
          <span class="doc-toc-label">${escapeHtml(item.title)}</span>
          ${lock}
        `

        if (item.path && item.exists) {
            node.setAttribute('role', 'link')
            node.tabIndex = 0
            node.addEventListener('click', () => {
                window.location.href = `/note/${encodeNotePath(item.path!)}`
            })
            node.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    window.location.href = `/note/${encodeNotePath(item.path!)}`
                }
            })
        } else {
            node.title = getI18n('bookDeadLink')
        }
        body.appendChild(node)
    }
}

function renderPageManager(
    body: HTMLElement,
    book: string,
    items: BookPageItem[],
    currentPath: string,
): void {
    body.innerHTML = ''
    if (items.length === 0) {
        body.innerHTML = `<div class="doc-tree-empty-hint">${getI18n('bookEmptyPages')}</div>`
        return
    }

    items.forEach((item, index) => {
        const row = document.createElement('div')
        row.className = `book-page-row${item.path === currentPath ? ' is-active' : ''}${item.exists ? '' : ' is-dead'}`
        row.innerHTML = `
          <span class="book-page-index">${String(index + 1).padStart(2, '0')}</span>
          <span class="book-page-title">${escapeHtml(item.title)}</span>
          <span class="book-page-actions">
            <button type="button" class="book-page-btn" data-act="edit">${getI18n('editButtonText')}</button>
            <button type="button" class="book-page-btn" data-act="rename">${getI18n('bookRename')}</button>
            <button type="button" class="book-page-btn danger" data-act="delete">${getI18n('bookDelete')}</button>
          </span>
        `
        row.querySelector('[data-act="edit"]')?.addEventListener('click', () => {
            if (!item.exists) return
            window.location.href = `/edit/${encodeNotePath(item.path)}`
        })
        row.querySelector('[data-act="rename"]')?.addEventListener('click', () => {
            void renamePage(item, book)
        })
        row.querySelector('[data-act="delete"]')?.addEventListener('click', () => {
            void deletePage(item, book)
        })
        body.appendChild(row)
    })
}

async function reloadSidebar(book: string): Promise<void> {
    const sidebar = el('#doc-sidebar')
    const body = el('#doc-sidebar-body')
    if (!sidebar || !body || !book) return

    const current = sidebar.dataset.notePath || ''
    const isEdit = sidebar.dataset.isEdit === 'true'
    const titleEl = el('#doc-sidebar-title')
    const bookLink = anchor('#doc-sidebar-book-link')

    try {
        if (sidebar.dataset.docType === 'book' && isEdit) {
            const { title, items } = await fetchPages(book)
            if (titleEl) titleEl.textContent = `${getI18n('bookPages')}`
            if (bookLink) {
                bookLink.hidden = false
                bookLink.textContent = title || book
                bookLink.href = `/note/${encodeNotePath(book)}`
                bookLink.title = book
            }
            renderPageManager(body, book, items, current)
            return
        }

        const toc = await fetchToc(book)
        const bookMeta = (await fetch(`/api/notes/${encodeNotePath(book)}`)
            .then(r => r.json())
            .catch(() => null)) as { data?: { metadata?: { title?: string } } } | null
        const bookTitle = bookMeta?.data?.metadata?.title || book
        if (titleEl) titleEl.textContent = getI18n('bookToc')
        if (bookLink) {
            bookLink.hidden = false
            bookLink.textContent = bookTitle
            bookLink.href = `/note/${encodeNotePath(book)}`
            bookLink.title = book
        }
        renderTocSidebar(body, toc, current)
    } catch (err) {
        body.innerHTML = `<div class="doc-tree-empty-hint">${getI18n('homeError')}</div>`
        errHandle(err)
    }
}

async function renamePage(item: BookPageItem, book: string): Promise<void> {
    const title = await showPrompt(getI18n('bookRenamePrompt'), item.title)
    if (title == null) return
    const next = title.trim()
    if (!next || next === item.title) return

    try {
        const res = await fetch(`/api/notes/${encodeNotePath(item.path)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: next }),
        })
        const json = (await res.json()) as { code: number; message?: string }
        if (json.code !== 0) throw new Error(json.message || 'rename failed')
        showToast(getI18n('bookRenamed'))
        await reloadSidebar(book)
    } catch (err) {
        errHandle(err)
    }
}

async function deletePage(item: BookPageItem, book: string): Promise<void> {
    const ok = await showConfirm(getI18n('bookDeleteConfirm').replace('{title}', item.title))
    if (!ok) return

    try {
        const res = await fetch(`/api/notes/${encodeNotePath(item.path)}?syncBook=1`, {
            method: 'DELETE',
        })
        const json = (await res.json()) as { code: number; message?: string }
        if (json.code !== 0) throw new Error(json.message || 'delete failed')
        showToast(getI18n('bookDeleted'))
        await reloadSidebar(book)
    } catch (err) {
        errHandle(err)
    }
}

async function createPage(book: string): Promise<void> {
    const title = await showPrompt(getI18n('bookNewPagePrompt'))
    if (title == null) return
    const next = title.trim()
    if (!next) return

    try {
        const res = await fetch(`/api/books/${encodeNotePath(book)}/pages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: next }),
        })
        const json = (await res.json()) as {
            code: number
            message?: string
            data?: { editUrl?: string }
        }
        if (json.code !== 0) throw new Error(json.message || 'create page failed')
        showToast(getI18n('bookPageCreated'))
        const goEdit = await showConfirm(getI18n('bookPageCreatedEdit'))
        if (goEdit && json.data?.editUrl) {
            window.location.href = json.data.editUrl
            return
        }
        await reloadSidebar(book)
    } catch (err) {
        errHandle(err)
    }
}

export function initDocSidebar(): void {
    const sidebar = el('#doc-sidebar')
    if (!sidebar) return
    const book = bookPathFromSidebar(sidebar)
    if (!book) return

    el('#btn-new-page')?.addEventListener('click', () => {
        void createPage(book)
    })
    void reloadSidebar(book)
}
