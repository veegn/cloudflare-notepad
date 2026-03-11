export type NoteMode = 'plain' | 'md' | 'json' | 'yaml'

export type LanguageCode = 'en' | 'zh'

export type LanguageDictionary = Record<string, string>

export type SupportedLanguageMap = Record<LanguageCode, LanguageDictionary>

export interface NoteMetadata {
    pw?: string
    share?: boolean
    updateAt?: number
    mode?: NoteMode
}

export interface TemplateData {
    lang: LanguageCode
    title: string
    content?: string
    ext?: NoteMetadata
    tips?: string
    isEdit?: boolean
    showPwPrompt?: boolean
    isHome?: boolean
    tipKey?: string
}

export interface QueryNoteResult {
    value: string
    metadata: NoteMetadata
}

export interface AuthCookie {
    auth?: string
}

declare global {
    const NOTES: KVNamespace
    const SCN_SALT: string
    const SCN_SECRET: string
    const SCN_INDEX_PASSWD: string | undefined
}

export {}
