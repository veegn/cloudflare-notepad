import { CONFIG, $, $$, getI18n } from './core/config'
import { getEditPath, getViewPath, initEditor } from './editor/editor'
import { renderEditorPreview } from './editor/renderers'
import { EDIT_BUTTONS, errHandle, GITHUB_LINK, showPasswordPrompt, showToast, showAlert, showConfirm, Theme, VIEW_BUTTONS } from './core/ui'
import { showCreateDocDialog } from './features/createDoc'
import { showDocActionsMenu, showRawViewer, showSharePanel } from './features/docManage'
import type { Mode, UIRefs } from './core/types'
import { initHomeTree } from './features/homeTree'
import { initDocSidebar } from './features/bookSidebar'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

let initialized = false

function isSystemPath(path: string): boolean {
    return (
        path === '/' ||
        path === '/new' ||
        path === '/favicon.ico' ||
        path.startsWith('/note/') ||
        path.startsWith('/edit/') ||
        path.startsWith('/api/') ||
        path.startsWith('/css/') ||
        path.startsWith('/js/')
    )
}

export async function passwdPrompt(): Promise<void> {
    const passwd = await showPasswordPrompt(getI18n('enterPasswordPrompt'))
    if (!passwd) {
        return
    }

    window.fetch(`/api/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: CONFIG.notePath, password: passwd }),
    })
        .then(async res => {
            if (!res.ok && !res.headers.get('content-type')?.includes('application/json')) {
                throw new Error(`Server Error: ${res.status} - ${await res.text()}`)
            }
            return res.json() as Promise<{ code: number; message?: string }>
        })
        .then(res => {
            if (res.code !== 0) {
                return errHandle(res.message || 'Auth failed')
            }
            window.location.reload()
        })
        .catch(errHandle)
}

export async function initApp(): Promise<void> {
    if (initialized) {
        return
    }
    initialized = true

    if (!isSystemPath(window.location.pathname)) {
        if (await showConfirm(getI18n('invalidPagePrompt'))) {
            window.location.href = `/note${window.location.pathname}`
            return
        }
    }

    const UI: UIRefs = {
        footerActions: $('#footer-actions'),
        editorTabActions: $('.editor-tab-actions'),
        githubContainer: $('#github-link-container'),
        lastMod: $('#last-modified-container'),
        codeEditorHost: $('#cm-editor'),
        loading: $('#loading'),
        preview: $('#preview'),
        previewScroll: $('#preview-scroll'),
        homePreview: $('#preview-home'),
        lineNumbers: $('#line-numbers'),
        formatTrigger: $('#format-trigger') as HTMLButtonElement | null,
        modePicker: $('#mode-picker'),
        modeTrigger: $('#mode-trigger') as HTMLButtonElement | null,
        modeMenu: $('#mode-menu'),
        composer: $('.composer-frame'),
    }

    if (UI.footerActions) {
        // Home is the document library — no note-level edit/raw/share actions
        // (those used to silently target `_index`).
        if (CONFIG.isHome) {
            UI.footerActions.innerHTML = ''
        } else {
            UI.footerActions.innerHTML = CONFIG.isEdit ? EDIT_BUTTONS() : VIEW_BUTTONS()
        }
    }
    if (UI.githubContainer) {
        UI.githubContainer.innerHTML = GITHUB_LINK()
    }

    const initModePicker = (): void => {
        if (!UI.modeMenu || !UI.modeTrigger || !CONFIG.isEdit || CONFIG.isHome) {
            return
        }

        // Move menu to body to avoid overflow clipping from statusbar parent chain
        if (UI.modeMenu.parentElement !== document.body) {
            document.body.appendChild(UI.modeMenu)
        }

        const modes: Array<{ id: Mode; label: string }> = [
            { id: 'plain', label: 'Txt' },
            { id: 'md', label: 'Markdown' },
            { id: 'json', label: 'JSON' },
            { id: 'yaml', label: 'YAML' },
        ]

        UI.modeTrigger.textContent = `${getI18n('formatMode')}: ${modes.find(mode => mode.id === CONFIG.mode)?.label || 'Txt'}`
        UI.modeMenu.innerHTML = modes.map(mode => `
            <div class="mode-picker-option ${CONFIG.mode === mode.id ? 'active' : ''}" data-mode="${mode.id}">
                <span>${mode.label}</span>
                <span>${mode.id}</span>
            </div>
        `).join('')

        const closeModeMenu = (): void => {
            UI.modeMenu?.classList.add('hide')
        }

        UI.modeTrigger.onclick = event => {
            event.stopPropagation()
            UI.modeMenu?.classList.toggle('hide')
        }

        $$<HTMLElement>('.mode-picker-option', UI.modeMenu).forEach(option => {
            option.onclick = (): void => {
                const mode = option.dataset.mode as Mode | undefined
                if (!mode || mode === CONFIG.mode) {
                    closeModeMenu()
                    return
                }

                window.fetch(`/api/notes/${CONFIG.notePath}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode }),
                })
                    .then(async res => {
                        if (!res.ok && !res.headers.get('content-type')?.includes('application/json')) {
                            throw new Error(`Server Error: ${res.status} - ${await res.text()}`)
                        }
                        return res.json() as Promise<{ code: number; message?: string }>
                    })
                    .then(res => {
                        if (res.code !== 0) {
                            return errHandle(res.message || 'Failed to update mode')
                        }
                        window.location.reload()
                    })
                    .catch(errHandle)
            }
        })

        document.addEventListener('click', event => {
            const target = event.target
            if (!(target instanceof Node) || !UI.modePicker?.contains(target)) {
                closeModeMenu()
            }
        })
    }

    const updateLastModified = (): void => {
        if (UI.lastMod && CONFIG.updateAt) {
            UI.lastMod.innerHTML = `<span class="last-modified">${getI18n('lastModified')} ${dayjs.unix(CONFIG.updateAt).fromNow()}</span>`
        }
    }

    initModePicker()
    Theme.init()
    dayjs.extend(relativeTime)

    updateLastModified()
    setInterval(updateLastModified, 30000)

    if (CONFIG.isHome && UI.homePreview && CONFIG.content) {
        renderEditorPreview('md', CONFIG.content, UI.homePreview)
    }

    if (CONFIG.isHome) {
        void initHomeTree()
    }

    initDocSidebar()

    initEditor(UI)

    document.body.addEventListener('click', async event => {
        let target = event.target as Node | null
        if (!target) {
            return
        }
        if (target.nodeType === Node.TEXT_NODE) {
            target = target.parentElement
        }
        if (!(target instanceof Element)) {
            return
        }

        const pwBtn = target.closest('.opt-pw')
        const shareBtn = target.closest('.opt-share')
        const editBtn = target.closest('.opt-edit')
        const rawBtn = target.closest('.opt-raw')
        const moreBtn = target.closest('.opt-more')
        const exitBtn = target.closest('.opt-exit')
        const themeBtn = target.closest('.theme-toggle')
        // `#btn-new-doc` is handled by homeTree; avoid double-opening the create dialog
        const newBtn = target.closest<HTMLAnchorElement>('a[href="/new"]')

        const currentTarget = (): { path: string; title: string; nodeType: string; shared: boolean } => ({
            path: CONFIG.notePath,
            title: CONFIG.title || CONFIG.notePath,
            nodeType: CONFIG.docType === 'book' ? 'book' : CONFIG.docType === 'page' ? 'page' : 'article',
            shared: CONFIG.shared ?? true,
        })

        if (newBtn) {
            event.preventDefault()
            await showCreateDocDialog()
        } else if (pwBtn) {
            const passwd = await showPasswordPrompt()
            if (passwd == null) {
                return
            }

            window.fetch(`/api/notes/${CONFIG.notePath}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: passwd.trim() }),
            })
                .then(async res => {
                    if (!res.ok && !res.headers.get('content-type')?.includes('application/json')) {
                        throw new Error(`Server Error: ${res.status} - ${await res.text()}`)
                    }
                    return res.json() as Promise<{ code: number; message?: string }>
                })
                .then(async res => {
                    if (res.code !== 0) {
                        return errHandle(res.message || 'Failed to update password')
                    }
                    await showAlert(passwd.trim() ? getI18n('passwordSaved') : getI18n('passwordRemoved'))
                    window.location.reload()
                })
                .catch(errHandle)
        } else if (shareBtn) {
            event.preventDefault()
            // Panel owns its own state/refresh — never reload the page here.
            void showSharePanel(currentTarget())
        } else if (moreBtn) {
            event.preventDefault()
            event.stopPropagation()
            showDocActionsMenu(moreBtn as HTMLElement, currentTarget(), {
                onChanged: () => {
                    window.location.reload()
                },
                // Share keeps the page; only rename/delete need a reload.
            })
        } else if (editBtn) {
            window.location.href = getEditPath()
        } else if (rawBtn) {
            event.preventDefault()
            if (!CONFIG.notePath || CONFIG.isHome) {
                showToast(getI18n('rawNeedDoc'))
                return
            }
            void showRawViewer(CONFIG.notePath)
        } else if (exitBtn) {
            window.location.href = getViewPath()
        } else if (themeBtn) {
            Theme.toggleTheme()
        }
    })
}

window.passwdPrompt = passwdPrompt
