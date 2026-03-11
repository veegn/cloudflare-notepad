export type Mode = 'plain' | 'md' | 'json' | 'yaml'

export interface I18nMap {
    [language: string]: Record<string, string>
}

export interface AppConfig {
    lang: string
    isEdit: boolean
    isHome: boolean
    updateAt: number | null
    pw: boolean
    mode: Mode
    content?: string
    i18n: I18nMap
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
