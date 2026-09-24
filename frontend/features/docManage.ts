import { CONFIG, getI18n } from '../core/config'
import { encodeNotePath, escapeHtml } from '../core/pathUtils'
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
        const res = await fetch(`/api/notes/${encodeNotePath(target.path)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
        })
        const json = (await res.json()) as { code: number; message?: string }
        if (json.code !== 0) throw new Error(json.message || 'rename failed')
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
        const res = await fetch(`/api/notes/${encodeNotePath(target.path)}`, {
            method: 'DELETE',
        })
        const json = (await res.json().catch(() => ({ code: 0 }))) as { code: number; message?: string }
        if (json.code !== 0) throw new Error(json.message || 'delete failed')
        showToast(getI18n('deleted'))
        hooks.onChanged?.()
    } catch (err) {
        errHandle(err)
    }
}

async function setShare(path: string, shared: boolean): Promise<void> {
    const res = await fetch(`/api/notes/${encodeNotePath(path)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share: shared }),
    })
    const json = (await res.json()) as { code: number; message?: string }
    if (json.code !== 0) throw new Error(json.message || 'share update failed')
}

function closeOnOverlay(overlay: HTMLElement, dialog: HTMLElement, cleanup: () => void): void {
    overlay.addEventListener('click', e => {
        if (e.target === overlay) cleanup()
    })
    dialog.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            e.preventDefault()
            cleanup()
        }
    })
}

function animateOut(overlay: HTMLElement, dialog: HTMLElement, done: () => void): void {
    overlay.classList.add('is-exiting')
    dialog.classList.add('is-exiting')
    let finished = false
    const finish = (): void => {
        if (finished) return
        finished = true
        overlay.remove()
        done()
    }
    overlay.addEventListener('animationend', finish)
    window.setTimeout(finish, 300)
}

/** Share panel: status + link + copy + public/private toggle. */
export function showSharePanel(target: DocManageTarget, hooks: DocManageHooks = {}): Promise<void> {
    return new Promise(resolve => {
        let shared = target.shared ?? CONFIG.shared ?? true
        const overlay = document.createElement('div')
        overlay.className = 'modal-overlay'
        const dialog = document.createElement('div')
        dialog.className = 'modal-dialog share-panel'
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-modal', 'true')

        const url = viewUrl(target.path)

        const render = (): void => {
            const statusKey = shared ? 'shareStatusPublic' : 'shareStatusPrivate'
            dialog.innerHTML = `
              <div class="modal-title">${getI18n('shareTitle')}</div>
              <div class="modal-desc">${escapeHtml(target.title || target.path)}</div>
              <div class="share-status ${shared ? 'is-public' : 'is-private'}" id="share-status" aria-live="polite">
                <span class="share-status-dot" aria-hidden="true"></span>
                <span class="share-status-text">${getI18n(statusKey)}</span>
              </div>
              <label class="field">
                <span class="field-label">${getI18n('shareLinkLabel')}</span>
                <input type="text" class="field-input share-link-input" id="share-link" readonly value="${escapeHtml(url)}" />
              </label>
              <div class="share-actions">
                <button type="button" class="modal-btn modal-btn-primary" id="share-copy">${getI18n('copy')}</button>
                <button type="button" class="modal-btn modal-btn-secondary" id="share-toggle">${shared ? getI18n('shareMakePrivate') : getI18n('shareMakePublic')}</button>
              </div>
              <div class="modal-actions">
                <button type="button" class="modal-btn modal-btn-secondary" id="share-close">${getI18n('close')}</button>
              </div>
            `

            dialog.querySelector('#share-copy')?.addEventListener('click', () => {
                void (async () => {
                    try {
                        await navigator.clipboard.writeText(url)
                        showToast(getI18n('linkCopied'))
                    } catch {
                        const input = dialog.querySelector<HTMLInputElement>('#share-link')
                        input?.select()
                        showToast(getI18n('copyLinkManual'))
                    }
                })()
            })

            dialog.querySelector('#share-toggle')?.addEventListener('click', () => {
                void (async () => {
                    const next = !shared
                    try {
                        await setShare(target.path, next)
                        shared = next
                        target.shared = next
                        if (CONFIG.notePath === target.path) {
                            CONFIG.shared = next
                        }
                        showToast(next ? getI18n('shareEnabled') : getI18n('shareDisabled'))
                        render()
                        hooks.onShared?.()
                    } catch (err) {
                        errHandle(err)
                    }
                })()
            })

            dialog.querySelector('#share-close')?.addEventListener('click', cleanup)
        }

        const cleanup = (): void => {
            animateOut(overlay, dialog, resolve)
        }

        closeOnOverlay(overlay, dialog, cleanup)
        render()
        overlay.appendChild(dialog)
        document.body.appendChild(overlay)
        requestAnimationFrame(() => {
            dialog.querySelector<HTMLButtonElement>('#share-copy')?.focus()
        })
    })
}

/** In-app raw source viewer (keeps the user inside the app). */
export function showRawViewer(path: string): Promise<void> {
    return new Promise(resolve => {
        const overlay = document.createElement('div')
        overlay.className = 'modal-overlay'
        const dialog = document.createElement('div')
        dialog.className = 'modal-dialog raw-viewer'
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-modal', 'true')

        dialog.innerHTML = `
          <div class="modal-title">${getI18n('rawTitle')}</div>
          <div class="modal-desc">${escapeHtml(path)}</div>
          <pre class="raw-body" id="raw-body">${escapeHtml(getI18n('homeLoading'))}</pre>
          <div class="modal-actions">
            <button type="button" class="modal-btn modal-btn-secondary" id="raw-copy">${getI18n('copy')}</button>
            <button type="button" class="modal-btn modal-btn-secondary" id="raw-open">${getI18n('rawOpenTab')}</button>
            <button type="button" class="modal-btn modal-btn-primary" id="raw-close">${getI18n('close')}</button>
          </div>
        `

        const cleanup = (): void => {
            animateOut(overlay, dialog, resolve)
        }

        closeOnOverlay(overlay, dialog, cleanup)
        overlay.appendChild(dialog)
        document.body.appendChild(overlay)

        dialog.querySelector('#raw-close')?.addEventListener('click', cleanup)
        dialog.querySelector('#raw-open')?.addEventListener('click', () => {
            window.open(`/api/notes/${encodeNotePath(path)}?raw=1`, '_blank', 'noopener')
        })

        let rawText = ''
        void (async () => {
            try {
                const res = await fetch(`/api/notes/${encodeNotePath(path)}?raw=1`)
                rawText = await res.text()
                const body = dialog.querySelector('#raw-body')
                if (body) body.textContent = rawText
            } catch (err) {
                const body = dialog.querySelector('#raw-body')
                if (body) body.textContent = String(err)
                errHandle(err)
            }
        })()

        dialog.querySelector('#raw-copy')?.addEventListener('click', () => {
            void (async () => {
                try {
                    await navigator.clipboard.writeText(rawText)
                    showToast(getI18n('copied'))
                } catch {
                    showToast(getI18n('copyFailed'))
                }
            })()
        })
    })
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
            menu.remove()
            item.onClick()
        })
        menu.appendChild(btn)
    }

    document.body.appendChild(menu)

    const rect = anchorEl.getBoundingClientRect()
    const menuWidth = 160
    const menuHeight = menu.offsetHeight || 180
    let left = rect.right - menuWidth
    let top = rect.bottom + 4
    if (left < 8) left = 8
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
        }
    }
    window.setTimeout(() => {
        document.addEventListener('click', close, true)
        document.addEventListener('keydown', onKey, true)
        menu.querySelector<HTMLButtonElement>('.doc-actions-menu-item')?.focus()
    }, 0)
}
