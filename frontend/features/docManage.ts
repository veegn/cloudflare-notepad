import { apiRequest } from '../core/api'
import { createModalDialog } from '../core/modal'
import { CONFIG, getI18n } from '../core/config'
import { escapeHtml } from '../core/html'
import { encodeNotePath } from '../core/pathUtils'
import { errHandle, showConfirm, showPrompt, showToast } from '../core/ui'

export type DocManageTarget = {
    path: string
    title: string
    nodeType?: string
    shared?: boolean
    hasChildren?: boolean
}

type DocManageHooks = {
    /** Rename / delete finished — refresh surrounding lists. */
    onChanged?: () => void
    /** Share visibility toggled — refresh badges only, keep panels open. */
    onShared?: () => void
    onRepair?: () => void
}

function viewUrl(path: string): string {
    return `${window.location.origin}/note/${encodeNotePath(path)}`
}

export async function copyDocLink(path: string): Promise<void> {
    const url = viewUrl(path)
    try {
        await navigator.clipboard.writeText(url)
        showToast(getI18n('linkCopied'))
    } catch {
        // Clipboard may be blocked — fall back to a selectable prompt.
        await showPrompt(getI18n('copyLinkManual'), url)
    }
}

export async function renameDoc(target: DocManageTarget, hooks: DocManageHooks = {}): Promise<void> {
    const next = await showPrompt(getI18n('renamePrompt'), target.title)
    if (next == null) return
    const title = next.trim()
    if (!title || title === target.title) return

    try {
        await apiRequest(`/api/notes/${encodeNotePath(target.path)}`, {
            method: 'PATCH',
            json: { title },
            errorMessage: 'rename failed',
        })
        showToast(getI18n('renamed'))
        hooks.onChanged?.()
    } catch (err) {
        errHandle(err)
    }
}

export async function deleteDoc(target: DocManageTarget, hooks: DocManageHooks = {}): Promise<void> {
    const kindLabel =
        target.nodeType === 'book'
            ? getI18n('badgeBook')
            : target.nodeType === 'dir'
              ? getI18n('badgeDir')
              : getI18n('badgeArticle')
    const extra = target.hasChildren ? getI18n('deleteHasChildrenHint') : ''
    const message = getI18n('deleteConfirm')
        .replace('{type}', kindLabel)
        .replace('{title}', target.title)
        .replace('{path}', target.path)
    const ok = await showConfirm(`${message}${extra ? `\n\n${extra}` : ''}`)
    if (!ok) return

    try {
        await apiRequest(`/api/notes/${encodeNotePath(target.path)}`, {
            method: 'DELETE',
            errorMessage: 'delete failed',
        })
        showToast(getI18n('deleted'))
        hooks.onChanged?.()
    } catch (err) {
        errHandle(err)
    }
}

async function setShare(path: string, shared: boolean): Promise<void> {
    await apiRequest(`/api/notes/${encodeNotePath(path)}`, {
        method: 'PATCH',
        json: { share: shared },
        errorMessage: 'share update failed',
    })
}

/** Share panel: status + link + copy + public/private toggle. */
export function showSharePanel(target: DocManageTarget, hooks: DocManageHooks = {}): Promise<void> {
    let shared = target.shared ?? CONFIG.shared ?? true
    const { dialog, open, close, result } = createModalDialog<void>({
        className: 'share-panel', label: getI18n('shareTitle'),
    }, undefined)
    const url = viewUrl(target.path)

    dialog.innerHTML = `
      <div class="modal-title">${getI18n('shareTitle')}</div>
      <div class="modal-desc">${escapeHtml(target.title || target.path)}</div>
      <div class="share-status" id="share-status" aria-live="polite">
        <span class="share-status-dot" aria-hidden="true"></span>
        <span class="share-status-text"></span>
      </div>
      <label class="field">
        <span class="field-label">${getI18n('shareLinkLabel')}</span>
        <input type="text" class="field-input share-link-input" id="share-link" readonly />
      </label>
      <div class="share-actions">
        <button type="button" class="modal-btn modal-btn-primary" id="share-copy">${getI18n('copy')}</button>
        <button type="button" class="modal-btn modal-btn-secondary" id="share-toggle"></button>
      </div>
      <div class="modal-actions">
        <button type="button" class="modal-btn modal-btn-secondary" id="share-close">${getI18n('close')}</button>
      </div>
    `
    const link = dialog.querySelector<HTMLInputElement>('#share-link')!
    const copy = dialog.querySelector<HTMLButtonElement>('#share-copy')!
    const toggle = dialog.querySelector<HTMLButtonElement>('#share-toggle')!
    const status = dialog.querySelector('#share-status')!
    const statusText = dialog.querySelector('.share-status-text')!
    link.value = url

    const updateStatus = (): void => {
        status.classList.toggle('is-public', shared)
        status.classList.toggle('is-private', !shared)
        statusText.textContent = getI18n(shared ? 'shareStatusPublic' : 'shareStatusPrivate')
        toggle.textContent = getI18n(shared ? 'shareMakePrivate' : 'shareMakePublic')
    }

    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(url)
            showToast(getI18n('linkCopied'))
        } catch {
            link.select()
            showToast(getI18n('copyLinkManual'))
        }
    })
    toggle.addEventListener('click', async () => {
        const next = !shared
        toggle.disabled = true
        try {
            await setShare(target.path, next)
            shared = next
            target.shared = next
            if (CONFIG.notePath === target.path) CONFIG.shared = next
            showToast(getI18n(next ? 'shareEnabled' : 'shareDisabled'))
            updateStatus()
            hooks.onShared?.()
        } catch (err) {
            errHandle(err)
        } finally {
            toggle.disabled = false
        }
    })
    dialog.querySelector('#share-close')!.addEventListener('click', () => close())
    updateStatus()
    open(copy)
    return result
}

/** In-app raw source viewer (keeps the user inside the app). */
export function showRawViewer(path: string): Promise<void> {
    const { dialog, open, close, result } = createModalDialog<void>({
        className: 'raw-viewer', label: getI18n('rawTitle'),
    }, undefined)
    dialog.innerHTML = `
      <div class="modal-title">${getI18n('rawTitle')}</div>
      <div class="modal-desc">${escapeHtml(path)}</div>
      <pre class="raw-body" id="raw-body">${escapeHtml(getI18n('homeLoading'))}</pre>
      <div class="modal-actions">
        <button type="button" class="modal-btn modal-btn-secondary" id="raw-copy" disabled>${getI18n('copy')}</button>
        <button type="button" class="modal-btn modal-btn-secondary" id="raw-open">${getI18n('rawOpenTab')}</button>
        <button type="button" class="modal-btn modal-btn-primary" id="raw-close">${getI18n('close')}</button>
      </div>
    `

    const closeButton = dialog.querySelector<HTMLButtonElement>('#raw-close')
    closeButton?.addEventListener('click', () => close())
    open(closeButton)
    dialog.querySelector('#raw-open')?.addEventListener('click', () => {
        window.open(`/api/notes/${encodeNotePath(path)}?raw=1`, '_blank', 'noopener')
    })

    const body = dialog.querySelector('#raw-body')
    const copyButton = dialog.querySelector<HTMLButtonElement>('#raw-copy')
    let rawText = ''
    void (async () => {
        try {
            const res = await fetch(`/api/notes/${encodeNotePath(path)}?raw=1`)
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
            rawText = await res.text()
            if (body) body.textContent = rawText
            if (copyButton) copyButton.disabled = false
        } catch (err) {
            if (body) body.textContent = String(err)
        }
    })()

    copyButton?.addEventListener('click', () => {
        void (async () => {
            try {
                await navigator.clipboard.writeText(rawText)
                showToast(getI18n('copied'))
            } catch {
                if (body) window.getSelection()?.selectAllChildren(body)
                showToast(getI18n('copyRawManual'))
            }
        })()
    })
    return result
}

function isProtectedPath(path: string): boolean {
    return (
        path === '_index' ||
        path === '.index' ||
        path === '' ||
        path.startsWith('_') ||
        path.startsWith('.') ||
        path.includes('.assets/')
    )
}

/** Lightweight row/dropdown menu used by list rows and page toolbars. */
export function showDocActionsMenu(
    anchorEl: HTMLElement,
    target: DocManageTarget,
    hooks: DocManageHooks = {},
): void {
    document.querySelector('.doc-actions-menu')?.remove()

    const menu = document.createElement('div')
    menu.className = 'doc-actions-menu'
    menu.setAttribute('role', 'menu')

    const items: Array<{ id: string; label: string; danger?: boolean; onClick: () => void }> = [
        { id: 'rename', label: getI18n('rename'), onClick: () => void renameDoc(target, hooks) },
        { id: 'copy', label: getI18n('copyLink'), onClick: () => void copyDocLink(target.path) },
        {
            id: 'share',
            label: getI18n('share'),
            onClick: () =>
                void showSharePanel(target, {
                    onShared: hooks.onShared ?? hooks.onChanged,
                }),
        },
        {
            id: 'raw',
            label: getI18n('rawButtonText'),
            onClick: () => void showRawViewer(target.path),
        },
        {
            id: 'delete',
            label: getI18n('delete'),
            danger: true,
            onClick: () => void deleteDoc(target, hooks),
        },
    ]

    if (hooks.onRepair) {
        items.splice(items.length - 1, 0, { id: 'repair', label: getI18n('repairTreeAction'), onClick: hooks.onRepair })
    }

    for (const item of items) {
        if (item.id === 'delete' && isProtectedPath(target.path)) {
            continue
        }
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = `doc-actions-menu-item${item.danger ? ' is-danger' : ''}`
        btn.setAttribute('role', 'menuitem')
        btn.textContent = item.label
        btn.addEventListener('click', e => {
            e.preventDefault()
            e.stopPropagation()
            close()
            item.onClick()
        })
        menu.appendChild(btn)
    }

    document.body.appendChild(menu)

    const rect = anchorEl.getBoundingClientRect()
    const menuWidth = menu.offsetWidth
    const menuHeight = menu.offsetHeight || 180
    const left = Math.max(8, Math.min(rect.right, window.innerWidth - 8) - menuWidth)
    let top = rect.bottom + 4
    if (top + menuHeight > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuHeight - 4)
    }
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`

    const close = (e?: Event): void => {
        if (e && menu.contains(e.target as Node)) return
        menu.remove()
        document.removeEventListener('click', close, true)
        document.removeEventListener('keydown', onKey, true)
    }
    const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') {
            e.preventDefault()
            close()
            anchorEl.focus({ preventScroll: true })
        }
    }
    window.setTimeout(() => {
        document.addEventListener('click', close, true)
        document.addEventListener('keydown', onKey, true)
        menu.querySelector<HTMLButtonElement>('.doc-actions-menu-item')?.focus()
    }, 0)
}
