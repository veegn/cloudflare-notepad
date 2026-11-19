import { apiRequest } from '../core/api'
import { encodeNotePath } from '../core/pathUtils'
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

    const modeLabel = modes.find(mode => mode.id === CONFIG.mode)?.label || 'Txt'
    const prefix = document.createElement('span')
    prefix.className = 'mode-picker-prefix'
    prefix.textContent = `${getI18n('formatMode')}: `
    modeTrigger.textContent = ''
    modeTrigger.append(prefix, modeLabel)
    modeTrigger.setAttribute('aria-label', `${prefix.textContent}${modeLabel}`)
    modeMenu.innerHTML = modes.map(mode => `
        <button type="button" class="mode-picker-option ${CONFIG.mode === mode.id ? 'active' : ''}" data-mode="${mode.id}">
            <span>${mode.label}</span>
            <span>${mode.id}</span>
        </button>
    `).join('')

    const setOpen = (open: boolean): void => {
        modeMenu.hidden = !open
        modeTrigger.setAttribute('aria-expanded', String(open))
    }
    setOpen(false)

    modeTrigger.onclick = event => {
        event.stopPropagation()
        setOpen(modeMenu.hasAttribute('hidden'))
    }

    $$<HTMLButtonElement>('.mode-picker-option', modeMenu).forEach(option => {
        option.onclick = (): void => {
            const mode = option.dataset.mode as Mode | undefined
            if (!mode || mode === CONFIG.mode) {
                setOpen(false)
                return
            }

            void apiRequest(`/api/notes/${encodeNotePath(CONFIG.notePath)}`, {
                method: 'PATCH', json: { mode }, errorMessage: 'Failed to update mode',
            })
                .then(() => window.location.reload())
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
