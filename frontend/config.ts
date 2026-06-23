import type { AppConfig } from './types'

export const CONFIG: AppConfig = window.CONFIG || {
    notePath: '',
    lang: 'en',
    isEdit: false,
    isHome: false,
    updateAt: null,
    pw: false,
    mode: 'plain',
    i18n: {
        en: {
            lastModified: 'Last modified',
            editButtonText: 'Edit',
            exitButtonText: 'Exit',
            invalidPagePrompt: 'This page does not exist. Do you want to view the note at this path?',
            share: 'Share',
            rawButtonText: 'Raw',
            err: 'Error',
            enterPasswordPrompt: 'Enter the note password',
            passwordSetPrompt: 'Set a password for this note. Leave empty to remove it.',
            passwordSaved: 'Password updated.',
            passwordRemoved: 'Password removed.',
            shareCopied: 'Share link copied.',
            formatNow: 'Format Now',
            formatMode: 'Format',
            formatApplied: 'Formatting applied.',
            formatFailed: 'Formatting failed.',
            mdViewEdit: 'Edit',
            mdViewSplit: 'Split',
            mdViewPreview: 'Preview',
        },
    },
}

export const KEYWORD_PATTERN = /\b(TODO|FIXME|NOTE|IMPORTANT|BUG|HACK|WARNING|DONE)\b/g

export const getI18n = (key: string): string => CONFIG.i18n?.[CONFIG.lang]?.[key] || CONFIG.i18n?.en?.[key] || key
export const $ = <T extends Element = Element>(selector: string, parent: ParentNode = document): T | null => parent.querySelector(selector)
export const $$ = <T extends Element = Element>(selector: string, parent: ParentNode = document): NodeListOf<T> => parent.querySelectorAll(selector)
