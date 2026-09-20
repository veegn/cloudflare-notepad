export type Mode = 'plain' | 'md' | 'json' | 'yaml'
export type DocType = 'article' | 'book' | 'page'

export interface I18nMap {
    [language: string]: Record<string, string>
}

export interface AppConfig {
    notePath: string
    lang: string
    isEdit: boolean
    isHome: boolean
    updateAt: number | null
    pw: boolean
    mode: Mode
    content?: string
    i18n: I18nMap
    docType?: DocType | string
    bookRef?: string | null
    title?: string | null
}

export interface UIRefs {
    footerActions: HTMLElement | null
    editorTabActions: HTMLElement | null
    githubContainer: HTMLElement | null
    lastMod: HTMLElement | null
    codeEditorHost: HTMLElement | null
    loading: HTMLElement | null
    preview: HTMLElement | null
    previewScroll: HTMLElement | null
    homePreview: HTMLElement | null
    lineNumbers: HTMLElement | null
    formatTrigger: HTMLButtonElement | null
    modePicker: HTMLElement | null
    modeTrigger: HTMLButtonElement | null
    modeMenu: HTMLElement | null
    composer: HTMLElement | null
}

export interface TreeNode {
    nodeType: 'dir' | 'book' | 'article' | string
    path: string
    title: string
    excerpt?: string | null
    updatedAt?: number | null
    mode?: Mode
    protected?: boolean
    shared?: boolean
    pageCount?: number | null
    bookRef?: string | null
    children?: TreeNode[]
}

export interface HomeTreeResponse {
    counts: { article: number; book: number }
    tree: TreeNode[]
}

export interface TocItem {
    title: string
    path?: string | null
    depth: number
    exists: boolean
    docType?: DocType | null
    protected?: boolean
    heading?: boolean
}

export interface BookPageItem {
    path: string
    title: string
    depth: number
    exists: boolean
    protected?: boolean
    updatedAt?: number | null
    mode?: Mode
}

export interface CreateDocPayload {
    docType: 'article' | 'book'
    path?: string
    title?: string
    summary?: string
}

export interface CreateDocResult {
    code: number
    message?: string
    data?: {
        path: string
        docType: DocType
        editUrl: string
        viewUrl: string
        title?: string
    }
}
