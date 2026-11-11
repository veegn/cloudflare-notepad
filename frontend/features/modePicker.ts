import { CONFIG, $$, getI18n } from '../core/config'
import { errHandle } from '../core/ui'
import type { Mode, UIRefs } from '../core/types'

type ModePickerRefs = Pick<UIRefs, 'modePicker' | 'modeTrigger' | 'modeMenu'>

export function initModePicker(ui: ModePickerRefs): void {
    const { modeMenu, modeTrigger, modePicker } = ui
    if (!modeMenu || !modeTrigger || !CONFIG.isEdit || CONFIG.isHome) return

    const modes: Array<{ id: Mode; label: string }> = [
        { id: 'plain', label: 'Txt' },
        { id: 'md', label: 'Markdown' },
        { id: 'json', label: 'JSON' },
        { id: 'yaml', label: 'YAML' },
    ]

    modeTrigger.textContent = `${getI18n('formatMode')}: ${modes.find(mode => mode.id === CONFIG.mode)?.label || 'Txt'}`
    modeMenu.innerHTML = modes.map(mode => `
        <button type="button" class="mode-picker-option ${CONFIG.mode === mode.id ? 'active' : ''}" data-mode="${mode.id}">
            <span>${mode.label}</span>
            <span>${mode.id}</span>
        </button>
    `).join('')

    const setOpen = (open: boolean): void => {
        modeMenu.classList.toggle('hide', !open)
        modeTrigger.setAttribute('aria-expanded', String(open))
    }

    modeTrigger.onclick = event => {
        event.stopPropagation()
        setOpen(modeMenu.classList.contains('hide'))
    }

    $$<HTMLButtonElement>('.mode-picker-option', modeMenu).forEach(option => {
        option.onclick = (): void => {
            const mode = option.dataset.mode as Mode | undefined
            if (!mode || mode === CONFIG.mode) {
                setOpen(false)
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
        if (!(target instanceof Node) || !modePicker?.contains(target)) {
            setOpen(false)
        }
    })
}
