import { getI18n } from './config'
import type { CreateDocPayload, CreateDocResult } from './types'
import { showToast, errHandle } from './ui'
import { input } from './pathUtils'

function slugify(input: string): string {
    let out = ''
    let prevDash = false
    for (const ch of input) {
        if (/[a-zA-Z0-9]/.test(ch)) {
            out += ch.toLowerCase()
            prevDash = false
        } else if (ch.charCodeAt(0) > 127) {
            out += ch
            prevDash = false
        } else if (!prevDash && out.length > 0) {
            out += '-'
            prevDash = true
        }
    }
    return out.replace(/^-+|-+$/g, '') || 'doc'
}

export function showCreateDocDialog(preselect: 'article' | 'book' = 'article'): Promise<void> {
    return new Promise(resolve => {
        const overlay = document.createElement('div')
        overlay.className = 'modal-overlay'

        const dialog = document.createElement('div')
        dialog.className = 'modal-dialog modal-create-doc'
        dialog.setAttribute('role', 'dialog')
        dialog.setAttribute('aria-modal', 'true')

        let docType: 'article' | 'book' = preselect

        const render = (): void => {
            dialog.innerHTML = `
              <div class="modal-title">${getI18n('createDocTitle')}</div>
              <div class="modal-desc">${getI18n('createDocHint')}</div>
              <div class="type-segment" role="tablist">
                <button type="button" class="type-segment-btn${docType === 'article' ? ' active' : ''}" data-type="article">${getI18n('createTypeArticle')}</button>
                <button type="button" class="type-segment-btn${docType === 'book' ? ' active' : ''}" data-type="book">${getI18n('createTypeBook')}</button>
              </div>
              <label class="field">
                <span class="field-label">${docType === 'book' ? getI18n('createBookPath') : getI18n('createArticlePath')}</span>
                <input type="text" class="field-input" id="create-doc-path" placeholder="${docType === 'book' ? getI18n('createBookPathPH') : getI18n('createArticlePathPH')}" />
              </label>
              <label class="field">
                <span class="field-label">${docType === 'book' ? getI18n('createBookTitle') : getI18n('createArticleTitle')}</span>
                <input type="text" class="field-input" id="create-doc-title" placeholder="${docType === 'book' ? getI18n('createBookTitlePH') : getI18n('createArticleTitlePH')}" />
              </label>
              ${docType === 'book' ? `
              <label class="field">
                <span class="field-label">${getI18n('createBookSummary')}</span>
                <input type="text" class="field-input" id="create-doc-summary" placeholder="${getI18n('createBookSummaryPH')}" />
              </label>` : ''}
              <div class="modal-actions">
                <button type="button" class="modal-btn modal-btn-secondary" id="create-doc-cancel">${getI18n('cancel')}</button>
                <button type="button" class="modal-btn modal-btn-primary" id="create-doc-ok">${getI18n('createDocSubmit')}</button>
              </div>
            `

            dialog.querySelectorAll<HTMLButtonElement>('.type-segment-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const t = btn.dataset.type as 'article' | 'book'
                    if (t !== docType) {
                        // keep path if user typed
                        const pathVal = (dialog.querySelector('#create-doc-path') as HTMLInputElement)?.value || ''
                        const titleVal = (dialog.querySelector('#create-doc-title') as HTMLInputElement)?.value || ''
                        docType = t
                        render()
                        const pathInput = dialog.querySelector('#create-doc-path') as HTMLInputElement | null
                        const titleInput = dialog.querySelector('#create-doc-title') as HTMLInputElement | null
                        if (pathInput) pathInput.value = pathVal
                        if (titleInput) titleInput.value = titleVal
                    }
                })
            })

            const titleInput = dialog.querySelector('#create-doc-title') as HTMLInputElement | null
            const pathInput = dialog.querySelector('#create-doc-path') as HTMLInputElement | null
            titleInput?.addEventListener('input', () => {
                if (docType === 'book' && pathInput && !pathInput.dataset.touched) {
                    pathInput.placeholder = slugify(titleInput.value || '')
                }
            })
            pathInput?.addEventListener('input', () => {
                pathInput.dataset.touched = '1'
            })

            dialog.querySelector('#create-doc-cancel')?.addEventListener('click', cleanup)
            dialog.querySelector('#create-doc-ok')?.addEventListener('click', () => {
                void submit()
            })
        }

        const submit = async (): Promise<void> => {
            const path = input('#create-doc-path', dialog)?.value?.trim() || ''
            const title = input('#create-doc-title', dialog)?.value?.trim() || ''
            const summary = input('#create-doc-summary', dialog)?.value?.trim() || ''

            const payload: CreateDocPayload = { docType }
            if (path) payload.path = path
            else if (docType === 'book') {
                showToast(getI18n('createBookPathRequired'))
                return
            }
            if (title) payload.title = title
            else if (docType === 'book') {
                showToast(getI18n('createBookTitleRequired'))
                return
            }
            if (summary) payload.summary = summary

            const okBtn = dialog.querySelector('#create-doc-ok') as HTMLButtonElement | null
            if (okBtn) {
                okBtn.disabled = true
                okBtn.textContent = getI18n('createDocSubmitting')
            }

            try {
                const res = await fetch('/api/docs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                })
                const json = (await res.json()) as CreateDocResult
                if (json.code !== 0 || !json.data) {
                    throw new Error(json.message || 'create failed')
                }
                cleanup()
                window.location.href = json.data.editUrl
                resolve()
            } catch (err) {
                errHandle(err)
                if (okBtn) {
                    okBtn.disabled = false
                    okBtn.textContent = getI18n('createDocSubmit')
                }
            }
        }

        const cleanup = (): void => {
            overlay.classList.add('is-exiting')
            dialog.classList.add('is-exiting')
            overlay.addEventListener('animationend', () => {
                overlay.remove()
                resolve()
            })
            // fallback if animation skipped
            window.setTimeout(() => {
                overlay.remove()
                resolve()
            }, 300)
        }

        overlay.addEventListener('click', e => {
            if (e.target === overlay) cleanup()
        })

        render()
        overlay.appendChild(dialog)
        document.body.appendChild(overlay)
        requestAnimationFrame(() => {
            dialog.querySelector<HTMLInputElement>('#create-doc-path')?.focus()
        })
    })
}
