import type { AppConfig } from './types'

export const CONFIG: AppConfig = window.CONFIG || {
    notePath: '',
    lang: 'en',
    isEdit: false,
    isHome: false,
    updateAt: null,
    pw: false,
    shared: true,
    mode: 'plain',
    i18n: {},
    docType: 'article',
    bookRef: null,
    title: null,
}

export const KEYWORD_PATTERN = /\b(TODO|FIXME|NOTE|IMPORTANT|BUG|HACK|WARNING|DONE)\b/g

export const getI18n = (key: string): string => CONFIG.i18n?.[CONFIG.lang]?.[key] || CONFIG.i18n?.en?.[key] || key
export const $ = <T extends Element = Element>(selector: string, parent: ParentNode = document): T | null => parent.querySelector(selector)
export const $$ = <T extends Element = Element>(selector: string, parent: ParentNode = document): NodeListOf<T> => parent.querySelectorAll(selector)
export const $html = (selector: string, parent: ParentNode = document): HTMLElement | null => {
    const el = parent.querySelector(selector)
    return el instanceof HTMLElement ? el : null
}
