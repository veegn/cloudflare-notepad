import { CONFIG, getI18n } from './config'

const GITHUB_ICON = (): string => `
<svg viewBox="64 64 896 896" focusable="false" data-icon="github" width="1em" height="1em" fill="currentColor" aria-hidden="true">
  <path d="M511.6 76.3C264.3 76.2 64 276.4 64 523.5 64 718.9 189.3 885 363.8 946c23.5 5.9 19.9-10.8 19.9-22.2v-77.5c-135.7 15.9-141.2-73.9-150.3-88.9C215 726 171.5 718 184.5 703c30.9-15.9 62.4 4 98.9 57.9 26.4 39.1 77.9 32.5 104 26 5.7-23.5 17.9-44.5 34.7-60.8-140.6-25.2-199.2-111-199.2-213 0-49.5 16.3-95 48.3-131.7-20.4-60.5 1.9-112.3 4.9-120 58.1-5.2 118.5 41.6 123.2 45.3 33-8.9 70.7-13.6 112.9-13.6 42.4 0 80.2 4.9 113.5 13.9 11.3-8.6 67.3-48.8 121.3-43.9 2.9 7.7 24.7 58.3 5.5 118 32.4 36.8 48.9 82.7 48.9 132.3 0 102.2-59 188.1-200 212.9a127.5 127.5 0 0138.1 91v112.5c.8 9 0 17.9 15 17.9 177.1-59.7 304.6-227 304.6-424.1 0-247.2-200.4-447.3-447.5-447.3z"></path>
</svg>
`

export const GITHUB_LINK = (): string => `
<a class="github-link" title="Github" target="_blank" href="https://github.com/veegn/cloudflare-notepad" rel="noreferrer">
  ${GITHUB_ICON()}
</a>
`

export const EDIT_BUTTONS = (): string => `
  <button type="button" class="opt-button opt-pw">${CONFIG.pw ? getI18n('changePW') : getI18n('setPW')}</button>
  <button type="button" class="opt-button opt-share">${getI18n('share')}</button>
  <button type="button" class="opt-button opt-exit">${getI18n('exitButtonText')}</button>
`

export const VIEW_BUTTONS = (): string => `
  <button type="button" class="opt-button opt-edit">${getI18n('editButtonText')}</button>
  <button type="button" class="opt-button opt-raw">${getI18n('rawButtonText')}</button>
`

export const Theme = {
    getCurrentTheme(): string {
        const savedTheme = localStorage.getItem('theme')
        if (savedTheme) {
            return savedTheme
        }
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark'
        }
        return 'light'
    },
    applyTheme(theme: string): void {
        document.documentElement.setAttribute('data-theme', theme)
        localStorage.setItem('theme', theme)
    },
    toggleTheme(): void {
        const currentTheme = Theme.getCurrentTheme()
        Theme.applyTheme(currentTheme === 'dark' ? 'light' : 'dark')
    },
    init(): void {
        document.documentElement.setAttribute('data-theme', Theme.getCurrentTheme())
    },
}

export const errHandle = (err: unknown): void => {
    alert(`${getI18n('err')}: ${String(err)}`)
}

export function showToast(message: string): void {
    const toast = document.createElement('div')
    toast.textContent = message
    toast.style.cssText = `
        position: fixed;
        bottom: calc(60px + env(safe-area-inset-bottom));
        right: 20px;
        padding: 10px 14px;
        border-radius: 8px;
        background: rgba(30, 30, 30, 0.96);
        color: white;
        font-size: 12px;
        z-index: 9999;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28);
    `
    document.body.appendChild(toast)
    setTimeout(() => {
        toast.remove()
    }, 1800)
}

export function showPasswordPrompt(message = ''): Promise<string | null> {
    const titleText = message || (CONFIG.pw ? getI18n('changePW') + ' - ' + getI18n('passwordSetPrompt') : getI18n('setPW'))

    return new Promise(resolve => {
        const overlay = document.createElement('div')
        overlay.className = 'pw-overlay'

        const dialog = document.createElement('div')
        dialog.className = 'pw-dialog'

        const titleEl = document.createElement('div')
        titleEl.className = 'pw-title'
        titleEl.textContent = titleText

        const input = document.createElement('input')
        input.type = 'text'
        input.className = 'pw-input'
        input.value = ''
        input.autocomplete = 'current-password'

        const actions = document.createElement('div')
        actions.className = 'pw-actions'

        const cancelBtn = document.createElement('button')
        cancelBtn.className = 'pw-cancel'
        cancelBtn.textContent = getI18n('cancel')
        cancelBtn.type = 'button'

        const okBtn = document.createElement('button')
        okBtn.className = 'pw-ok'
        okBtn.textContent = getI18n('confirm')
        okBtn.type = 'button'

        const cleanup = (value: string | null): void => {
            overlay.remove()
            resolve(value)
        }

        cancelBtn.onclick = () => cleanup(null)
        okBtn.onclick = () => cleanup(input.value)

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup(null)
            }
        })

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                cleanup(input.value)
            } else if (e.key === 'Escape') {
                cleanup(null)
            }
        })

        actions.append(cancelBtn, okBtn)
        dialog.append(titleEl, input, actions)
        overlay.appendChild(dialog)
        document.body.appendChild(overlay)

        requestAnimationFrame(() => input.focus())
    })
}
