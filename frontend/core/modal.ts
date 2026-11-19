import { getI18n } from './config'

interface ModalOptions {
    className?: string
    label?: string
}

export function createModalDialog<T>({ className, label }: ModalOptions, cancelValue: T) {
    const opener = document.activeElement
    const overlay = document.createElement('div')
    overlay.className = 'modal-overlay'
    const dialog = document.createElement('div')
    dialog.className = className ? `modal-dialog ${className}` : 'modal-dialog'
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    if (label) dialog.setAttribute('aria-label', label)
    dialog.tabIndex = -1
    overlay.append(dialog)

    let resolve!: (value: T) => void
    const result = new Promise<T>(done => { resolve = done })
    let closing = false

    const close = (value: T): void => {
        if (closing) return
        closing = true
        const finish = (): void => {
            window.clearTimeout(fallback)
            overlay.removeEventListener('animationend', onAnimationEnd)
            const restoreFocus = overlay.contains(document.activeElement) || document.activeElement === document.body
            overlay.remove()
            if (restoreFocus && opener instanceof HTMLElement && opener.isConnected) {
                opener.focus({ preventScroll: true })
            }
            resolve(value)
        }
        const onAnimationEnd = (event: AnimationEvent): void => {
            if (event.target === overlay && event.animationName === 'modal-fade-out') finish()
        }
        const fallback = window.setTimeout(finish, 300)
        overlay.addEventListener('animationend', onAnimationEnd)
        overlay.classList.add('is-exiting')
        dialog.classList.add('is-exiting')
    }

    overlay.addEventListener('click', event => {
        if (event.target === overlay) close(cancelValue)
    })
    dialog.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        close(cancelValue)
    })

    const open = (focus?: HTMLElement | null): void => {
        document.body.append(overlay)
        requestAnimationFrame(() => {
            if (!closing && Array.from(document.querySelectorAll('.modal-overlay')).pop() === overlay) {
                (focus ?? dialog).focus()
            }
        })
    }

    return { dialog, open, close, result }
}

export function modalButton(label: 'confirm' | 'cancel', onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `modal-btn modal-btn-${label === 'confirm' ? 'primary' : 'secondary'}`
    button.textContent = getI18n(label) || (label === 'confirm' ? 'OK' : 'Cancel')
    button.addEventListener('click', onClick)
    return button
}
