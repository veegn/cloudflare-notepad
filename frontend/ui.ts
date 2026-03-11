import { CONFIG, getI18n } from './config'

const GITHUB_ICON = (): string => `
<svg viewBox="64 64 896 896" focusable="false" data-icon="github" width="1em" height="1em" fill="currentColor" aria-hidden="true">
  <path d="M511.6 76.3C264.3 76.2 64 276.4 64 523.5 64 718.9 189.3 885 363.8 946c23.5 5.9 19.9-10.8 19.9-22.2v-77.5c-135.7 15.9-141.2-73.9-150.3-88.9C215 726 171.5 718 184.5 703c30.9-15.9 62.4 4 98.9 57.9 26.4 39.1 77.9 32.5 104 26 5.7-23.5 17.9-44.5 34.7-60.8-140.6-25.2-199.2-111-199.2-213 0-49.5 16.3-95 48.3-131.7-20.4-60.5 1.9-112.3 4.9-120 58.1-5.2 118.5 41.6 123.2 45.3 33-8.9 70.7-13.6 112.9-13.6 42.4 0 80.2 4.9 113.5 13.9 11.3-8.6 67.3-48.8 121.3-43.9 2.9 7.7 24.7 58.3 5.5 118 32.4 36.8 48.9 82.7 48.9 132.3 0 102.2-59 188.1-200 212.9a127.5 127.5 0 0138.1 91v112.5c.8 9 0 17.9 15 17.9 177.1-59.7 304.6-227 304.6-424.1 0-247.2-200.4-447.3-447.5-447.3z"></path>
</svg>
`

export const GITHUB_LINK = (): string => `
<a class="github-link" title="Github" target="_blank" href="https://github.com/veegn/serverless-cloud-notepad" rel="noreferrer">
  ${GITHUB_ICON()}
</a>
`

const THEME_TOGGLE_BTN = (): string => `
<button class="opt-button theme-toggle" title="Toggle theme">
  <span class="theme-toggle-icon">
    <span class="theme-toggle-sun">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>
    </span>
    <span class="theme-toggle-moon">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
    </span>
  </span>
</button>
`

export const EDIT_BUTTONS = (): string => `
  <button class="opt-button opt-pw">${CONFIG.pw ? getI18n('changePW') : getI18n('setPW')}</button>
  <button class="opt-button opt-share">${getI18n('share')}</button>
  ${THEME_TOGGLE_BTN()}
`

export const VIEW_BUTTONS = (): string => `
  <button class="opt-button opt-edit">${getI18n('editButtonText')}</button>
  <button class="opt-button opt-raw">${getI18n('rawButtonText')}</button>
  ${THEME_TOGGLE_BTN()}
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
        bottom: 60px;
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
