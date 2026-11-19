import { apiRequest } from '../core/api'
import { createModalDialog } from '../core/modal'
import { getI18n } from '../core/config'
import type { CreateDocPayload, CreateDocResult } from '../core/types'
import { showToast, errHandle } from '../core/ui'
import { input } from '../core/pathUtils'

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
    const { dialog, open, close, result } = createModalDialog<void>({
        className: 'modal-create-doc',
        label: getI18n('createDocTitle'),
    }, undefined)
    let docType = preselect

    dialog.innerHTML = `
      <div class="modal-title">${getI18n('createDocTitle')}</div>
      <div class="modal-desc">${getI18n('createDocHint')}</div>
      <div class="type-segment" role="tablist">
        <button type="button" class="type-segment-btn" data-type="article">${getI18n('createTypeArticle')}</button>
        <button type="button" class="type-segment-btn" data-type="book">${getI18n('createTypeBook')}</button>
      </div>
      <label class="field">
        <span class="field-label" id="create-doc-path-label"></span>
        <input type="text" class="field-input" id="create-doc-path" />
      </label>
      <label class="field">
        <span class="field-label" id="create-doc-title-label"></span>
        <input type="text" class="field-input" id="create-doc-title" />
      </label>
      <label class="field" id="create-doc-summary-field">
        <span class="field-label">${getI18n('createBookSummary')}</span>
        <input type="text" class="field-input" id="create-doc-summary" />
      </label>
      <div class="modal-actions">
        <button type="button" class="modal-btn modal-btn-secondary" id="create-doc-cancel">${getI18n('cancel')}</button>
        <button type="button" class="modal-btn modal-btn-primary" id="create-doc-ok">${getI18n('createDocSubmit')}</button>
      </div>
    `
    const pathInput = input('#create-doc-path', dialog)!
    const titleInput = input('#create-doc-title', dialog)!
    const summaryInput = input('#create-doc-summary', dialog)!
    const summaryField = dialog.querySelector<HTMLElement>('#create-doc-summary-field')!
    const ok = dialog.querySelector<HTMLButtonElement>('#create-doc-ok')!
    const typeButtons = dialog.querySelectorAll<HTMLButtonElement>('.type-segment-btn')
    summaryInput.placeholder = getI18n('createBookSummaryPH')

    const updateFields = (): void => {
        const book = docType === 'book'
        dialog.querySelector('#create-doc-path-label')!.textContent = getI18n(book ? 'createBookPath' : 'createArticlePath')
        dialog.querySelector('#create-doc-title-label')!.textContent = getI18n(book ? 'createBookTitle' : 'createArticleTitle')
        pathInput.placeholder = getI18n(book ? 'createBookPathPH' : 'createArticlePathPH')
        titleInput.placeholder = getI18n(book ? 'createBookTitlePH' : 'createArticleTitlePH')
        summaryField.hidden = !book
        summaryInput.disabled = !book
        typeButtons.forEach(button => button.classList.toggle('active', button.dataset.type === docType))
    }

    typeButtons.forEach(button => button.addEventListener('click', () => {
        const next = button.dataset.type === 'book' ? 'book' : 'article'
        if (ok.disabled || next === docType) return
        docType = next
        updateFields()
    }))
    titleInput.addEventListener('input', () => {
        if (docType === 'book' && !pathInput.dataset.touched) {
            pathInput.placeholder = slugify(titleInput.value)
        }
    })
    pathInput.addEventListener('input', () => { pathInput.dataset.touched = '1' })

    const submit = async (): Promise<void> => {
        const path = pathInput.value.trim()
        const title = titleInput.value.trim()
        const summary = docType === 'book' ? summaryInput.value.trim() : ''
        if (docType === 'book' && (!path || !title)) {
            showToast(getI18n(path ? 'createBookTitleRequired' : 'createBookPathRequired'))
            return
        }

        const payload: CreateDocPayload = { docType }
        if (path) payload.path = path
        if (title) payload.title = title
        if (summary) payload.summary = summary

        ok.disabled = true
        ok.textContent = getI18n('createDocSubmitting')
        try {
            const data = await apiRequest<NonNullable<CreateDocResult['data']>>('/api/docs', {
                method: 'POST', json: payload, requireData: true, errorMessage: 'create failed',
            })
            close()
            window.location.href = data.editUrl
        } catch (err) {
            errHandle(err)
            ok.disabled = false
            ok.textContent = getI18n('createDocSubmit')
        }
    }

    dialog.querySelector('#create-doc-cancel')!.addEventListener('click', () => close())
    ok.addEventListener('click', () => { void submit() })
    updateFields()
    open(pathInput)
    return result
}
