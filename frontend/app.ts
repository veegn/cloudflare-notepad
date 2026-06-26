import { CONFIG, $, $$, getI18n } from './config'
import { getEditPath, getViewPath, initEditor } from './editor'
import { renderEditorPreview } from './renderers'
import { EDIT_BUTTONS, errHandle, GITHUB_LINK, showPasswordPrompt, showToast, showAlert, showConfirm, Theme, VIEW_BUTTONS, showPrompt } from './ui'
import type { Mode, UIRefs } from './types'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

let initialized = false

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

    const path = window.location.pathname
    const isSystemPath =
        path === '/' ||
        path === '/new' ||
        path === '/favicon.ico' ||
        path.startsWith('/note/') ||
        path.startsWith('/edit/') ||
        path.startsWith('/api/') ||
        path.startsWith('/css/') ||
        path.startsWith('/js/')

    if (!isSystemPath) {
        if (await showConfirm(getI18n('invalidPagePrompt'))) {
            window.location.href = `/note${path}`
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
        UI.footerActions.innerHTML = CONFIG.isEdit ? EDIT_BUTTONS() : VIEW_BUTTONS()
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
        const exitBtn = target.closest('.opt-exit')
        const themeBtn = target.closest('.theme-toggle')
        const newBtn = target.closest<HTMLAnchorElement>('a[href="/new"]')

        if (newBtn) {
            event.preventDefault()
            const path = await showPrompt(getI18n('newNotePathPrompt'))
            if (path === null) {
                return
            }
            if (path.trim() === '') {
                window.location.href = '/new'
            } else {
                window.location.href = `/edit/${encodeURIComponent(path.trim())}`
            }
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
            const shareUrl = `${window.location.origin}${getViewPath()}`
            Promise.resolve(navigator.clipboard.writeText(shareUrl))
                .then(() => showToast(getI18n('shareCopied')))
                .catch(errHandle)
        } else if (editBtn) {
            window.location.href = getEditPath()
        } else if (rawBtn) {
            window.location.href = `/api/notes/${CONFIG.notePath}?raw=1`
        } else if (exitBtn) {
            window.location.href = getViewPath()
        } else if (themeBtn) {
            Theme.toggleTheme()
        }
    })
}

window.passwdPrompt = passwdPrompt
