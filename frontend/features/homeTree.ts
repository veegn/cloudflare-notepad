import { CONFIG, getI18n } from '../core/config'
import type { HomeTreeResponse, TreeNode } from '../core/types'
import { showCreateDocDialog } from './createDoc'
import { errHandle } from '../core/ui'
import { el, encodeNotePath, escapeHtml, input } from '../core/pathUtils'
import { runRepairBook, runRepairAll } from './repair'
import { showDocActionsMenu } from './docManage'

const EXPAND_KEY = 'homeTreeExpand'

let treeData: TreeNode[] = []
let counts = { article: 0, book: 0 }
let expand = loadExpand()
let filter = 'all'
let query = ''
let rerender: (() => void) | null = null

function loadExpand(): Set<string> {
    try {
        const raw = localStorage.getItem(EXPAND_KEY)
        if (!raw) return new Set()
        return new Set(JSON.parse(raw) as string[])
    } catch {
        return new Set()
    }
}

function saveExpand(set: Set<string>): void {
    localStorage.setItem(EXPAND_KEY, JSON.stringify(Array.from(set)))
}

function filterTree(nodes: TreeNode[], activeFilter: string, search: string): TreeNode[] {
    const q = search.trim().toLowerCase()
    const out: TreeNode[] = []
    for (const node of nodes) {
        const kids = filterTree(node.children || [], activeFilter, search)
        const queryOk =
            !q ||
            node.title.toLowerCase().includes(q) ||
            node.path.toLowerCase().includes(q) ||
            (node.excerpt || '').toLowerCase().includes(q)

        if (node.nodeType === 'dir') {
            if (kids.length > 0) out.push({ ...node, children: kids })
            continue
        }
        if ((activeFilter === 'all' || node.nodeType === activeFilter) && queryOk) {
            out.push({ ...node, children: [] })
        } else if (kids.length > 0) {
            out.push({ ...node, children: kids })
        }
    }
    return out
}

function typeBadge(node: TreeNode): string {
    if (node.nodeType === 'book') {
        return `<span class="badge badge-book">${getI18n('badgeBook')}</span>`
    }
    if (node.nodeType === 'dir') {
        return `<span class="badge badge-dir">${getI18n('badgeDir')}</span>`
    }
    return `<span class="badge badge-article">${getI18n('badgeArticle')}</span>`
}

function rowMeta(node: TreeNode): string {
    if (node.nodeType === 'dir') return ''
    return [
        node.pageCount != null && node.nodeType === 'book'
            ? getI18n('homePageCount').replace('{n}', String(node.pageCount))
            : '',
        node.protected ? getI18n('homeProtected') : '',
        !node.shared && node.nodeType !== 'dir' ? getI18n('homePrivate') : '',
    ]
        .filter(Boolean)
        .join(' · ')
}

/** Hover row actions: overflow menu + book repair. */
function rowActions(node: TreeNode): string {
    if (node.nodeType === 'dir') return ''
    const repair =
        node.nodeType === 'book'
            ? `<button type="button" class="doc-tree-action-btn" data-repair="${escapeHtml(node.path)}">${getI18n('repairTreeAction')}</button>`
            : ''
    return `<span class="doc-tree-actions">
      ${repair}
      <button type="button" class="doc-tree-more" data-more="${escapeHtml(node.path)}" aria-label="${escapeHtml(getI18n('docMore'))}" title="${escapeHtml(getI18n('docMore'))}">⋯</button>
    </span>`
}

function findNode(nodes: TreeNode[], path: string): TreeNode | null {
    for (const n of nodes) {
        if (n.path === path) return n
        const hit = findNode(n.children || [], path)
        if (hit) return hit
    }
    return null
}

function toggleExpand(path: string): void {
    if (expand.has(path)) expand.delete(path)
    else expand.add(path)
    saveExpand(expand)
    rerender?.()
}

function ensureAncestorsExpanded(nodes: TreeNode[]): void {
    for (const n of nodes) {
        if (n.nodeType === 'dir') {
            expand.add(n.path)
            ensureAncestorsExpanded(n.children || [])
        }
    }
}

function renderNode(node: TreeNode, level: number, host: HTMLElement): void {
    const row = document.createElement('div')
    row.className = `doc-tree-row is-${node.nodeType}`
    row.style.setProperty('--tree-level', String(level))
    row.setAttribute('role', 'treeitem')
    row.dataset.path = node.path
    row.dataset.type = node.nodeType

    const isDir = node.nodeType === 'dir'
    const hasChildren = (node.children || []).length > 0
    const open = expand.has(node.path)

    if (isDir || (node.nodeType === 'article' && hasChildren)) {
        row.setAttribute('aria-expanded', open ? 'true' : 'false')
    }

    const chevron =
        isDir || hasChildren
            ? `<button type="button" class="doc-tree-chevron" aria-label="toggle">${open ? '▾' : '▸'}</button>`
            : `<span class="doc-tree-chevron is-empty"></span>`

    const icon = isDir ? '📁' : node.nodeType === 'book' ? '📖' : '📄'
    const href = isDir ? '#' : `/note/${encodeNotePath(node.path)}`
    // Title is primary; path is a muted subtitle so slugs stay readable.
    const displayTitle = node.title || node.path
    const showPath = !isDir && node.path && node.path !== displayTitle

    row.innerHTML = `
      ${chevron}
      <span class="doc-tree-icon" aria-hidden="true">${icon}</span>
      <span class="doc-tree-badge">${typeBadge(node)}</span>
      <span class="doc-tree-text">
        <a class="doc-tree-title" href="${href}">${escapeHtml(displayTitle)}</a>
        ${showPath ? `<span class="doc-tree-path" title="${escapeHtml(node.path)}">${escapeHtml(node.path)}</span>` : ''}
      </span>
      <span class="doc-tree-meta">${escapeHtml(rowMeta(node))}</span>
      ${rowActions(node)}
    `

    if (isDir) {
        row.querySelector('.doc-tree-title')?.addEventListener('click', e => {
            e.preventDefault()
            toggleExpand(node.path)
        })
    }
    row.querySelector('.doc-tree-chevron')?.addEventListener('click', e => {
        e.preventDefault()
        e.stopPropagation()
        if (isDir || hasChildren) toggleExpand(node.path)
    })
    if (node.nodeType === 'book') {
        row.title = getI18n('homeBookTooltip')
    }

    host.appendChild(row)

    if ((isDir || node.nodeType === 'article') && hasChildren && open) {
        for (const child of node.children || []) {
            renderNode(child, level + 1, host)
        }
    }
}

function renderEmpty(host: HTMLElement, hasAnyData: boolean): void {
    const empty = document.createElement('div')
    empty.className = 'doc-tree-empty'
    empty.innerHTML = hasAnyData
        ? `<div class="doc-tree-empty-title">${getI18n('homeNoSearchResult')}</div>
           <button type="button" class="welcome-button" id="home-clear-search">${getI18n('homeClearSearch')}</button>`
        : `<div class="doc-tree-empty-title">${getI18n('homeEmptyAll')}</div>
           <div class="doc-tree-empty-hint">${getI18n('homeEmptyHint')}</div>
           <div class="welcome-actions">
             <button type="button" class="welcome-button primary" data-create="article">${getI18n('homeNewArticle')}</button>
             <button type="button" class="welcome-button" data-create="book">${getI18n('homeNewBook')}</button>
           </div>`
    host.appendChild(empty)

    empty.querySelector('#home-clear-search')?.addEventListener('click', () => {
        query = ''
        const search = input('#home-search')
        if (search) search.value = ''
        rerender?.()
    })
    empty.querySelectorAll<HTMLButtonElement>('[data-create]').forEach(btn => {
        btn.addEventListener('click', () => {
            void showCreateDocDialog(btn.dataset.create as 'article' | 'book')
        })
    })
}

function renderTree(): void {
    const host = el('#doc-tree')
    if (!host) return

    const filtered = filterTree(treeData, filter, query)
    host.innerHTML = ''

    if (filtered.length === 0) {
        renderEmpty(host, treeData.length > 0)
        return
    }
    if (query.trim()) {
        ensureAncestorsExpanded(filtered)
    }
    for (const node of filtered) {
        renderNode(node, 0, host)
    }
}

function expandAll(): void {
    const walk = (nodes: TreeNode[]): void => {
        for (const n of nodes) {
            if (n.nodeType === 'dir') {
                expand.add(n.path)
                walk(n.children || [])
            }
        }
    }
    walk(treeData)
    saveExpand(expand)
    renderTree()
}

function collapseAll(): void {
    expand = new Set()
    saveExpand(expand)
    renderTree()
}

async function loadTree(opts: { refresh?: boolean } = {}): Promise<void> {
    const qs = opts.refresh ? '?refresh=1' : ''
    const res = await fetch(`/api/home-tree${qs}`, { cache: opts.refresh ? 'no-store' : 'default' })
    const json = (await res.json()) as {
        code: number
        message?: string
        data?: HomeTreeResponse
    }
    if (json.code !== 0 || !json.data) {
        throw new Error(json.message || 'Failed to load tree')
    }
    treeData = json.data.tree || []
    counts = json.data.counts || { article: 0, book: 0 }
    const countsEl = el('#home-counts')
    if (countsEl) {
        countsEl.textContent = `${getI18n('homeArticles')} ${counts.article} · ${getI18n('homeBooks')} ${counts.book}`
    }
    renderTree()
}

let toolbarBound = false

export async function initHomeTree(): Promise<void> {
    const host = el('#doc-tree')
    if (!host) return

    rerender = () => void loadTree({ refresh: true })

    if (!toolbarBound) {
        toolbarBound = true
        el('#btn-new-doc')?.addEventListener('click', () => {
            void showCreateDocDialog()
        })
        el('#home-expand-all')?.addEventListener('click', expandAll)
        el('#home-collapse-all')?.addEventListener('click', collapseAll)
        el('#home-repair-all')?.addEventListener('click', () => {
            void runRepairAll()
        })

        const search = input('#home-search')
        let debounce: number | undefined
        search?.addEventListener('input', () => {
            window.clearTimeout(debounce)
            debounce = window.setTimeout(() => {
                query = search.value || ''
                renderTree()
            }, 300)
        })

        el('#home-filters')?.querySelectorAll<HTMLButtonElement>('.home-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                el('#home-filters')
                    ?.querySelectorAll('.home-chip')
                    .forEach(c => c.classList.remove('active'))
                chip.classList.add('active')
                filter = chip.dataset.filter || 'all'
                renderTree()
            })
        })

        // Event delegation: works after every re-render.
        host.addEventListener('click', e => {
            const target = e.target as Element | null
            const repairBtn = target?.closest('[data-repair]') as HTMLElement | null
            if (repairBtn) {
                e.preventDefault()
                e.stopPropagation()
                const path = repairBtn.getAttribute('data-repair')
                if (path) void runRepairBook(path)
                return
            }
            const moreBtn = target?.closest('[data-more]') as HTMLElement | null
            if (moreBtn) {
                e.preventDefault()
                e.stopPropagation()
                const path = moreBtn.getAttribute('data-more')
                if (!path) return
                const row = moreBtn.closest('.doc-tree-row') as HTMLElement | null
                const node = findNode(treeData, path)
                if (!node) return
                showDocActionsMenu(
                    moreBtn,
                    {
                        path: node.path,
                        title: node.title || node.path,
                        nodeType: node.nodeType,
                        shared: node.shared,
                        hasChildren: (node.children || []).length > 0 || row?.classList.contains('is-book') === true,
                    },
                    {
                        onChanged: () => {
                            void loadTree({ refresh: true })
                        },
                        onShared: () => {
                            void loadTree({ refresh: true })
                        },
                    },
                )
            }
        })

        window.addEventListener('scn:repaired', () => {
            void loadTree({ refresh: true })
        })
    }

    try {
        // Prefer the server-side cache for first paint; mutations refresh explicitly.
        await loadTree()
    } catch (err) {
        host.innerHTML = `<div class="doc-tree-empty"><div class="doc-tree-empty-title">${getI18n('homeError')}</div>
          <button type="button" class="welcome-button" id="home-retry">${getI18n('homeRetry')}</button></div>`
        el('#home-retry')?.addEventListener('click', () => {
            void initHomeTree()
        })
        errHandle(err)
    }
}

export function refreshHomeTree(): void {
    if (CONFIG.isHome) {
        void initHomeTree()
    }
}
