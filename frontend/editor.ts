import { KEYWORD_PATTERN, CONFIG, getI18n } from './config'
import { buildFormatError, formatTextByMode } from './formatters'
import { renderEditorPreview } from './renderers'
import { errHandle, showToast } from './ui'
import type { Mode, UIRefs } from './types'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { EditorState, Extension, RangeSetBuilder } from '@codemirror/state'
import {
    Decoration,
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    highlightSpecialChars,
    keymap,
    lineNumbers,
    placeholder,
    rectangularSelection,
    ViewPlugin,
    ViewUpdate,
} from '@codemirror/view'
import { yaml } from '@codemirror/lang-yaml'

type EditorAdapter = {
    getValue: () => string
    setValue: (value: string) => void
    focus: () => void
    getScrollTop: () => number
    getScrollLeft: () => number
}

type CodeEditorHost = HTMLElement & {
    __scnView?: EditorView
}

type EditorCallbacks = {
    onDocChange?: (value: string) => void
    onScroll?: (scrollTop: number, scrollLeft: number, value: string) => void
}

type MarkdownLayout = 'edit' | 'split' | 'preview'

const MARKDOWN_LAYOUT_KEY = 'markdown-layout'

export const debounce = <T extends unknown[]>(func: (...args: T) => void, delay: number) => {
    let tid: ReturnType<typeof setTimeout> | null = null
    return (...args: T): void => {
        if (tid) {
            clearTimeout(tid)
        }
        tid = setTimeout(() => {
            func(...args)
        }, delay)
    }
}

export function getViewPath(): string {
    return CONFIG.notePath === '_index' ? '/' : `/note/${CONFIG.notePath}`
}

export function getEditPath(): string {
    return `/edit/${CONFIG.notePath}`
}

function getModeExtensions(mode: Mode): Extension[] {
    if (mode === 'json') {
        return [json()]
    }
    if (mode === 'yaml') {
        return [yaml()]
    }
    if (mode === 'md') {
        return [markdown()]
    }
    return []
}

const keywordMark = Decoration.mark({ class: 'cm-keyword-highlight' })

const keywordHighlightPlugin = ViewPlugin.fromClass(class {
    decorations

    constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view)
    }

    update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
            this.decorations = this.buildDecorations(update.view)
        }
    }

    buildDecorations(view: EditorView) {
        const builder = new RangeSetBuilder<Decoration>()
        for (const { from, to } of view.visibleRanges) {
            const text = view.state.doc.sliceString(from, to)
            const pattern = new RegExp(KEYWORD_PATTERN.source, 'g')
            let match: RegExpExecArray | null
            while ((match = pattern.exec(text)) !== null) {
                builder.add(from + match.index, from + match.index + match[0].length, keywordMark)
            }
        }
        return builder.finish()
    }
}, {
    decorations: plugin => plugin.decorations,
})

function createEditorTheme(mode: Mode): Extension {
    const isMarkdown = mode === 'md'

    return EditorView.theme({
        '&': {
            height: '100%',
            backgroundColor: 'transparent',
            color: 'var(--vscode-text)',
        },
        '.cm-scroller': {
            overflow: 'auto',
            lineHeight: isMarkdown ? '1.8' : '1.7',
            fontFamily: isMarkdown ? "'IBM Plex Sans', 'Segoe UI', sans-serif" : "'IBM Plex Mono', Consolas, monospace",
        },
        '.cm-content': {
            minHeight: '100%',
            padding: isMarkdown ? '28px 0 72px' : '24px 0 56px',
            caretColor: 'var(--vscode-accent)',
        },
        '.cm-line': isMarkdown
            ? {
                maxWidth: '760px',
                margin: '0 auto',
                padding: '0 24px',
            }
            : {
                padding: '0 28px',
            },
        '.cm-gutters': {
            borderRight: '1px solid var(--vscode-border)',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            color: 'var(--vscode-text-subtle)',
        },
        '.cm-gutterElement': {
            padding: '0 12px 0 0',
            minWidth: '56px',
        },
        '.cm-activeLine': isMarkdown
            ? {
                backgroundColor: 'rgba(55, 148, 255, 0.08)',
                borderRadius: '8px',
            }
            : {
                backgroundColor: 'rgba(255, 255, 255, 0.035)',
            },
        '.cm-activeLineGutter': {
            color: isMarkdown ? 'var(--vscode-text-subtle)' : 'var(--vscode-accent)',
        },
        '.cm-selectionBackground, ::selection': {
            backgroundColor: 'var(--vscode-selection) !important',
        },
        '&.cm-focused': {
            outline: 'none',
        },
        '.cm-tooltip': {
            border: '1px solid var(--vscode-border)',
            backgroundColor: 'var(--vscode-editor)',
            color: 'var(--vscode-text)',
        },
    })
}

function createCodeMirrorAdapter(host: HTMLElement, mode: Mode, callbacks: EditorCallbacks = {}): EditorAdapter {
    const editorHost = host as CodeEditorHost
    const initialDoc = editorHost.textContent || ''
    editorHost.textContent = ''

    const state = EditorState.create({
        doc: initialDoc,
        extensions: [
            mode === 'md' ? [] : [lineNumbers(), highlightActiveLineGutter()],
            highlightSpecialChars(),
            history(),
            drawSelection(),
            dropCursor(),
            EditorState.allowMultipleSelections.of(true),
            indentOnInput(),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            bracketMatching(),
            closeBrackets(),
            autocompletion(),
            rectangularSelection(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            EditorView.lineWrapping,
            placeholder(editorHost.dataset.placeholder || ''),
            keymap.of([
                indentWithTab,
                ...closeBracketsKeymap,
                ...defaultKeymap,
                ...historyKeymap,
                ...searchKeymap,
                ...completionKeymap,
            ]),
            keywordHighlightPlugin,
            createEditorTheme(mode),
            ...getModeExtensions(mode),
            EditorView.updateListener.of(update => {
                if (update.docChanged) {
                    callbacks.onDocChange?.(update.state.doc.toString())
                }
            }),
        ].flat(),
    })

    const view = new EditorView({
        state,
        parent: editorHost,
    })
    editorHost.__scnView = view

    view.scrollDOM.addEventListener('scroll', () => {
        callbacks.onScroll?.(view.scrollDOM.scrollTop, view.scrollDOM.scrollLeft, view.state.doc.toString())
    })

    return {
        getValue: () => view.state.doc.toString(),
        setValue: (value: string) => {
            const current = view.state.doc.toString()
            if (current === value) {
                return
            }
            view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
        },
        focus: () => view.focus(),
        getScrollTop: () => view.scrollDOM.scrollTop,
        getScrollLeft: () => view.scrollDOM.scrollLeft,
    }
}

function persistValue(UI: UIRefs, value: string): Promise<void> {
    if (UI.loading) {
        UI.loading.style.opacity = '1'
    }

    return window.fetch(`/api/notes/${CONFIG.notePath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: value }),
    })
        .then(res => res.json() as Promise<{ code: number; message: string }>)
        .then(res => {
            if (res.code !== 0) {
                errHandle(res.message)
            }
        })
        .catch(errHandle)
        .finally(() => {
            if (UI.loading) {
                UI.loading.style.opacity = '0'
            }
        })
}

function bindFormatAction(UI: UIRefs, editor: EditorAdapter): void {
    const runFormatAction = (): void => {
        try {
            const nextValue = formatTextByMode(CONFIG.mode, editor.getValue())
            editor.setValue(nextValue)
            showToast(getI18n('formatApplied'))
        } catch (error) {
            const formattedError = buildFormatError(CONFIG.mode, error, editor.getValue())
            showToast(`${getI18n('formatFailed')} ${formattedError.message || formattedError}`)
        }
    }

    if (UI.formatTrigger) {
        UI.formatTrigger.textContent = getI18n('formatNow')
        UI.formatTrigger.addEventListener('click', runFormatAction)
    }

    document.addEventListener('keydown', event => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
            const target = event.target
            if (!(target instanceof Element) || !UI.codeEditorHost?.contains(target)) {
                return
            }
            event.preventDefault()
            runFormatAction()
        }
    })
}

function getMarkdownLayout(): MarkdownLayout {
    const stored = window.localStorage.getItem(MARKDOWN_LAYOUT_KEY)
    if (stored === 'edit' || stored === 'preview' || stored === 'split') {
        return stored
    }
    return 'split'
}

function applyMarkdownLayout(UI: UIRefs, layout: MarkdownLayout): void {
    UI.composer?.classList.remove('md-layout-edit', 'md-layout-split', 'md-layout-preview')
    UI.composer?.classList.add(`md-layout-${layout}`)
    window.localStorage.setItem(MARKDOWN_LAYOUT_KEY, layout)
}

function initMarkdownLayoutControls(UI: UIRefs, editor: EditorAdapter): void {
    if (!UI.editorTabActions) {
        return
    }

    const layouts: Array<{ id: MarkdownLayout; labelKey: 'mdViewEdit' | 'mdViewSplit' | 'mdViewPreview' }> = [
        { id: 'edit', labelKey: 'mdViewEdit' },
        { id: 'split', labelKey: 'mdViewSplit' },
        { id: 'preview', labelKey: 'mdViewPreview' },
    ]

    UI.editorTabActions.innerHTML = `
        <div class="md-layout-toggle" id="md-layout-toggle">
            ${layouts.map(layout => `
                <button class="md-layout-button" type="button" data-layout="${layout.id}">${getI18n(layout.labelKey)}</button>
            `).join('')}
        </div>
    `

    const syncActive = (layout: MarkdownLayout): void => {
        UI.editorTabActions?.querySelectorAll<HTMLButtonElement>('.md-layout-button').forEach(button => {
            button.classList.toggle('active', button.dataset.layout === layout)
        })
    }

    const setLayout = (layout: MarkdownLayout): void => {
        applyMarkdownLayout(UI, layout)
        syncActive(layout)
        if (layout !== 'preview') {
            editor.focus()
        }
    }

    const initialLayout = getMarkdownLayout()
    setLayout(initialLayout)

    UI.editorTabActions.querySelectorAll<HTMLButtonElement>('.md-layout-button').forEach(button => {
        button.addEventListener('click', () => {
            const layout = button.dataset.layout as MarkdownLayout | undefined
            if (!layout) {
                return
            }
            setLayout(layout)
        })
    })
}

function initMarkdownEditor(UI: UIRefs): void {
    if (!UI.codeEditorHost || !UI.preview || !UI.previewScroll) {
        return
    }

    const persistDraft = debounce((value: string) => {
        void persistValue(UI, value)
    }, 700)

    const renderPreview = (value: string, scrollTop = 0): void => {
        renderEditorPreview('md', value, UI.preview)
        UI.previewScroll!.scrollTop = scrollTop
        UI.previewScroll!.scrollLeft = 0
    }

    const editor = createCodeMirrorAdapter(UI.codeEditorHost, 'md', {
        onDocChange: value => {
            renderPreview(value, editor.getScrollTop())
            persistDraft(value)
        },
        onScroll: (scrollTop, _scrollLeft, value) => {
            UI.previewScroll!.scrollTop = scrollTop
            UI.previewScroll!.scrollLeft = 0
            renderEditorPreview('md', value, UI.preview)
        },
    })

    renderPreview(editor.getValue(), 0)
    initMarkdownLayoutControls(UI, editor)
    bindFormatAction(UI, editor)
    editor.focus()
}

function initCodeEditor(UI: UIRefs): void {
    if (!UI.codeEditorHost) {
        return
    }

    const persistDraft = debounce((value: string) => {
        void persistValue(UI, value)
    }, 700)

    const editor = createCodeMirrorAdapter(UI.codeEditorHost, CONFIG.mode, {
        onDocChange: value => {
            persistDraft(value)
        },
    })

    bindFormatAction(UI, editor)
    editor.focus()
}

export function initEditor(UI: UIRefs): void {
    if (!CONFIG.isEdit) {
        renderEditorPreview(CONFIG.mode, CONFIG.content || '', UI.preview)
        return
    }

    if (CONFIG.mode === 'md') {
        initMarkdownEditor(UI)
        return
    }

    initCodeEditor(UI)
}
