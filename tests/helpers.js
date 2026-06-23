function uniqueNotePath() {
    return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

async function switchMode(page, mode) {
    await page.locator('#mode-trigger').click()
    await page.locator(`.mode-picker-option[data-mode="${mode}"]`).click()
    await page.waitForFunction(expectedMode => window.CONFIG?.mode === expectedMode, mode)
}

async function saveNote(request, notePath, content) {
    return request.put(`/api/notes/${notePath}`, {
        data: { content: content },
    })
}

async function fillCodeEditor(page, content) {
    await page.locator('#cm-editor').evaluate((node, value) => {
        const view = node.__scnView
        const current = view.state.doc.toString()
        view.dispatch({
            changes: { from: 0, to: current.length, insert: value },
        })
        view.focus()
    }, content)
}

async function readCodeEditor(page) {
    return page.locator('#cm-editor').evaluate(node => node.__scnView.state.doc.toString())
}

module.exports = {
    fillCodeEditor,
    readCodeEditor,
    uniqueNotePath,
    switchMode,
    saveNote,
}
