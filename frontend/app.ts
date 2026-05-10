import { CONFIG, $, $$, getI18n } from './config'
import { getEditPath, getViewPath, initEditor } from './editor'
import { renderEditorPreview } from './renderers'
import { EDIT_BUTTONS, errHandle, GITHUB_LINK, showPasswordPrompt, showToast, Theme, VIEW_BUTTONS } from './ui'
import type { Mode, UIRefs } from './types'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'

let initialized = false

export async function passwdPrompt(): Promise<void> {
    const passwd = await showPasswordPrompt(getI18n('enterPasswordPrompt'))
    if (!passwd) {
        return
    }

    window.fetch(`${getEditPath()}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passwd }),
    })
        .then(async res => {
            if (!res.ok && !res.headers.get('content-type')?.includes('application/json')) {
                throw new Error(`Server Error: ${res.status} - ${await res.text()}`)
            }
            return res.json() as Promise<{ err: number; msg: string; data?: { refresh?: boolean } }>
        })
        .then(res => {
            if (res.err !== 0) {
                return errHandle(res.msg)
            }
            if (res.data?.refresh) {
                window.location.reload()
            }
        })
        .catch(errHandle)
}

export function initApp(): void {
    if (initialized) {
        return
    }
    initialized = true

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

                window.fetch(`${window.location.pathname}/setting`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode }),
                })
                    .then(async res => {
                        if (!res.ok && !res.headers.get('content-type')?.includes('application/json')) {
                            throw new Error(`Server Error: ${res.status} - ${await res.text()}`)
                        }
                        return res.json() as Promise<{ err: number; msg: string }>
                    })
                    .then(res => {
                        if (res.err !== 0) {
                            return errHandle(res.msg)
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

    if (CONFIG.isHome && UI.homePreview) {
        renderEditorPreview('md', CONFIG.content || '', UI.homePreview)
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
        const themeBtn = target.closest('.theme-toggle')

        if (pwBtn) {
            const passwd = await showPasswordPrompt()
            if (passwd == null) {
                return
            }

            window.fetch(`${window.location.pathname}/pw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ passwd: passwd.trim() }),
            })
                .then(async res => {
                    if (!res.ok && !res.headers.get('content-type')?.includes('application/json')) {
                        throw new Error(`Server Error: ${res.status} - ${await res.text()}`)
                    }
                    return res.json() as Promise<{ err: number; msg: string }>
                })
                .then(res => {
                    if (res.err !== 0) {
                        return errHandle(res.msg)
                    }
                    alert(passwd.trim() ? getI18n('passwordSaved') : getI18n('passwordRemoved'))
                    window.location.reload()
                })
                .catch(errHandle)
        } else if (shareBtn) {
            const shareUrl = `${window.location.origin}${getViewPath().replace('/.index', '/')}`
            Promise.resolve(navigator.clipboard.writeText(shareUrl))
                .then(() => showToast(getI18n('shareCopied')))
                .catch(errHandle)
        } else if (editBtn) {
            window.location.href = getEditPath()
        } else if (rawBtn) {
            window.location.href = `${getViewPath()}/raw`
        } else if (themeBtn) {
            Theme.toggleTheme()
        }
    })
}

window.passwdPrompt = passwdPrompt
