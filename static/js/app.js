/**
 * Configuration and I18n
 */
const CONFIG = window.CONFIG || {
    lang: 'en',
    isEdit: false,
    updateAt: null,
    pw: false,
    mode: 'plain',
    i18n: {
        'en': { lastModified: 'Last Modified', editButtonText: 'Edit', share: 'Share' },
        'zh': { lastModified: '上次保存', editButtonText: '编辑', share: '分享' }
    }
}

const getI18n = (key) => CONFIG.i18n[CONFIG.lang][key] || key

/**
 * Utility: DOM Selector Helper
 */
const $ = (s, p = document) => p.querySelector(s)
const $$ = (s, p = document) => p.querySelectorAll(s)

/**
 * UI Components (Client-side)
 */
const GITHUB_ICON = () => `
<svg viewBox="64 64 896 896" focusable="false" data-icon="github" width="1em" height="1em" fill="currentColor" aria-hidden="true">
  <path d="M511.6 76.3C264.3 76.2 64 276.4 64 523.5 64 718.9 189.3 885 363.8 946c23.5 5.9 19.9-10.8 19.9-22.2v-77.5c-135.7 15.9-141.2-73.9-150.3-88.9C215 726 171.5 718 184.5 703c30.9-15.9 62.4 4 98.9 57.9 26.4 39.1 77.9 32.5 104 26 5.7-23.5 17.9-44.5 34.7-60.8-140.6-25.2-199.2-111-199.2-213 0-49.5 16.3-95 48.3-131.7-20.4-60.5 1.9-112.3 4.9-120 58.1-5.2 118.5 41.6 123.2 45.3 33-8.9 70.7-13.6 112.9-13.6 42.4 0 80.2 4.9 113.5 13.9 11.3-8.6 67.3-48.8 121.3-43.9 2.9 7.7 24.7 58.3 5.5 118 32.4 36.8 48.9 82.7 48.9 132.3 0 102.2-59 188.1-200 212.9a127.5 127.5 0 0138.1 91v112.5c.8 9 0 17.9 15 17.9 177.1-59.7 304.6-227 304.6-424.1 0-247.2-200.4-447.3-447.5-447.3z"></path>
</svg>
`

const GITHUB_LINK = () => `
<a class="github-link" title="Github" target="_blank" href="https://github.com/veegn/serverless-cloud-notepad" rel="noreferrer">
  ${GITHUB_ICON()}
</a>
`

const THEME_TOGGLE_BTN = () => `
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

const EDIT_BUTTONS = () => `
  <button class="opt-button opt-pw">${CONFIG.pw ? getI18n('changePW') : getI18n('setPW')}</button>
  <button class="opt-button opt-share">${getI18n('share')}</button>
  <div id="mode-tabs" class="mode-tabs"></div>
  ${THEME_TOGGLE_BTN()}
`

const VIEW_BUTTONS = () => `
  <button class="opt-button opt-edit">${getI18n('editButtonText')}</button>
  <button class="opt-button opt-raw">Raw</button>
  ${THEME_TOGGLE_BTN()}
`

/**
 * Theme management
 */
const Theme = {
    getCurrentTheme: () => {
        const savedTheme = localStorage.getItem('theme')
        if (savedTheme) return savedTheme
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
        return 'light'
    },
    applyTheme: (theme) => {
        document.body.classList.add('theme-transition')
        document.documentElement.setAttribute('data-theme', theme)
        localStorage.setItem('theme', theme)
        const themeToggle = $('.theme-toggle')
        if (themeToggle) themeToggle.classList.add('theme-toggle-active')
        setTimeout(() => {
            document.body.classList.remove('theme-transition')
            if (themeToggle) themeToggle.classList.remove('theme-toggle-active')
        }, 300)
    },
    toggleTheme: () => {
        const currentTheme = Theme.getCurrentTheme()
        Theme.applyTheme(currentTheme === 'dark' ? 'light' : 'dark')
    },
    init: () => {
        document.documentElement.setAttribute('data-theme', Theme.getCurrentTheme())
    }
}

const errHandle = (err) => alert(`${getI18n('err') || 'Error'}: ${err}`)

const throttle = (func, delay) => {
    let tid = null
    return (...arg) => {
        if (tid) return;
        tid = setTimeout(() => {
            func(...arg)
            tid = null
        }, delay)
    }
}

const passwdPrompt = () => {
    const passwd = window.prompt(getI18n('pepw'))
    if (!passwd || !passwd.trim()) return

    const path = location.pathname
    window.fetch(`${path}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passwd }),
    })
        .then(res => res.json())
        .then(res => {
            if (res.err !== 0) return errHandle(res.msg)
            if (res.data.refresh) window.location.reload()
        })
        .catch(err => errHandle(err))
}

const renderPlain = (node, text) => { if (node) node.innerHTML = DOMPurify.sanitize(text) }
const renderMarkdown = (node, text) => { if (node) node.innerHTML = DOMPurify.sanitize(marked.parse(text)) }
const renderJson = (node, text) => {
    if (node) {
        try {
            const obj = JSON.parse(text)
            node.innerHTML = '<pre>' + DOMPurify.sanitize(JSON.stringify(obj, null, 2)) + '</pre>'
        } catch (e) {
            node.innerHTML = '<pre style="color:red">' + DOMPurify.sanitize(e.toString()) + '</pre>'
        }
    }
}
const renderYaml = (node, text) => {
    if (node) {
        try {
            const obj = jsyaml.load(text)
            node.innerHTML = '<pre>' + DOMPurify.sanitize(JSON.stringify(obj, null, 2)) + '</pre>'
        } catch (e) {
            node.innerHTML = '<pre style="color:red">' + DOMPurify.sanitize(e.toString()) + '</pre>'
        }
    }
}

window.addEventListener('DOMContentLoaded', function () {
    /**
     * DOM elements centralized in UI object
     */
    const UI = {
        footerActions: $('#footer-actions'),
        githubContainer: $('#github-link-container'),
        modeTabs: $('#mode-tabs'),
        lastMod: $('#last-modified-container'),
        textarea: $('#contents'),
        loading: $('#loading'),
        layer: $('.layer'),
        previews: {
            plain: $('#preview-plain'),
            md: $('#preview-md'),
            json: $('#preview-json'),
            yaml: $('#preview-yaml')
        }
    }

    // Hydrate Components
    if (UI.footerActions) UI.footerActions.innerHTML = CONFIG.isEdit ? EDIT_BUTTONS() : VIEW_BUTTONS()
    if (UI.githubContainer) UI.githubContainer.innerHTML = GITHUB_LINK()

    // Mode Tabs Logic
    const initModeTabs = () => {
        const $tabs = $('#mode-tabs')
        if (!$tabs || !CONFIG.isEdit) return

        const modes = [
            { id: 'plain', label: 'Txt' },
            { id: 'md', label: 'Markdown' },
            { id: 'json', label: 'JSON' },
            { id: 'yaml', label: 'YAML' }
        ]

        $tabs.innerHTML = `
            <div class="tab-indicator"></div>
            ${modes.map(m => `<div class="mode-tab ${CONFIG.mode === m.id ? 'active' : ''}" data-mode="${m.id}">${m.label}</div>`).join('')}
        `

        const $indicator = $('.tab-indicator', $tabs)
        const updateTabSlider = () => {
            const $activeTab = $('.mode-tab.active', $tabs)
            if ($activeTab && $indicator) {
                $indicator.style.width = `${$activeTab.offsetWidth}px`
                $indicator.style.left = `${$activeTab.offsetLeft}px`
            }
        }

        setTimeout(updateTabSlider, 100)
        window.addEventListener('resize', updateTabSlider)

        $$('.mode-tab', $tabs).forEach($tab => {
            $tab.onclick = function () {
                const mode = this.dataset.mode
                if (mode === CONFIG.mode) return

                $$('.mode-tab', $tabs).forEach(t => t.classList.remove('active'))
                this.classList.add('active')
                updateTabSlider()

                document.body.classList.add('no-theme-transition')
                window.fetch(`${window.location.pathname}/setting`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode }),
                })
                    .then(res => res.json())
                    .then(res => {
                        if (res.err !== 0) return errHandle(res.msg)
                        window.location.reload()
                    })
                    .catch(err => errHandle(err))
            }
        })
    }

    const updateLastModified = () => {
        if (UI.lastMod && CONFIG.updateAt) {
            UI.lastMod.innerHTML = `<span class="last-modified">${getI18n('lastModified')} ${dayjs.unix(CONFIG.updateAt).fromNow()}</span>`
        }
    }

    /**
     * Initialization execution
     */
    initModeTabs()
    Theme.init()
    if (window.dayjs && window.dayjs_plugin_relativeTime) dayjs.extend(dayjs_plugin_relativeTime)

    updateLastModified()
    setInterval(updateLastModified, 30000)

    // Edit Mode Support
    const isSplitSupported = ['md', 'json', 'yaml'].includes(CONFIG.mode)
    if (UI.textarea) {
        if (CONFIG.isEdit && isSplitSupported) UI.layer.classList.add('split-view')

        renderPlain(UI.previews.plain, UI.textarea.value)
        renderMarkdown(UI.previews.md, UI.textarea.value)
        renderJson(UI.previews.json, UI.textarea.value)
        renderYaml(UI.previews.yaml, UI.textarea.value)

        // Sync Scroll
        let isScrolling = false
        UI.textarea.addEventListener('scroll', () => {
            if (isScrolling || !isSplitSupported) return
            isScrolling = true
            const activePreview = $(`#preview-${CONFIG.mode}`)
            if (activePreview) {
                const scrollPct = UI.textarea.scrollTop / (UI.textarea.scrollHeight - UI.textarea.clientHeight)
                activePreview.scrollTop = scrollPct * (activePreview.scrollHeight - activePreview.clientHeight)
            }
            setTimeout(() => { isScrolling = false }, 50)
        })

        // Content Update
        UI.textarea.oninput = throttle(function () {
            renderMarkdown(UI.previews.md, UI.textarea.value)
            renderJson(UI.previews.json, UI.textarea.value)
            renderYaml(UI.previews.yaml, UI.textarea.value)

            UI.loading.style.opacity = '1'
            window.fetch('', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ t: UI.textarea.value }),
            })
                .then(res => res.json())
                .then(res => res.err !== 0 && errHandle(res.msg))
                .catch(err => errHandle(err))
                .finally(() => UI.loading.style.opacity = '0')
        }, 1000)
    }

    /**
     * Delegate Action Listeners
     */
    document.body.onclick = (e) => {
        const t = e.target
        if (t.closest('.opt-pw')) {
            const passwd = window.prompt(getI18n('enpw'))
            if (passwd == null) return
            window.fetch(`${window.location.pathname}/pw`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ passwd: passwd.trim() }),
            })
                .then(res => res.json())
                .then(res => {
                    if (res.err !== 0) return errHandle(res.msg)
                    alert(passwd ? getI18n('pwss') : getI18n('pwrs'))
                })
        }
        else if (t.closest('.opt-share')) {
            const shareUrl = `${window.location.origin}${window.location.pathname.replace("/edit", "")}`
            const cb = (typeof clipboardCopy === 'function') ? clipboardCopy : (s) => navigator.clipboard.writeText(s)
            Promise.resolve(cb(shareUrl)).then(() => showToast(getI18n('cpys')))
        }
        else if (t.closest('.opt-edit')) window.location.href = window.location.pathname + '/edit'
        else if (t.closest('.opt-raw')) window.location.href = window.location.pathname + '/raw'
        else if (t.closest('.theme-toggle')) Theme.toggleTheme()
    }
})

function showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 60px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 12px 24px;
        border-radius: 4px;
        font-size: 14px;
        z-index: 10000;
        opacity: 0;
        transition: opacity 0.3s ease;
    `;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '1'; }, 10);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => { document.body.removeChild(toast); }, 300);
    }, 3000);
}
