import jwt from '@tsndr/cloudflare-worker-jwt'
import * as TEMPL from './template'
import { LEGACY_SALT, SECRET, SUPPORTED_LANG } from './constant'
import type { AuthCookie, LanguageCode, QueryNoteResult, TemplateData } from './types'

const PBKDF2_ITERATIONS = 120000
const PBKDF2_HASH = 'SHA-256'
const PBKDF2_KEY_LENGTH = 256

type TemplateName = keyof typeof TEMPL

export const genRandomStr = (n: number): string => {
    const charset = '2345679abcdefghjkmnpqrstwxyz'
    return Array.from({ length: n }, () => charset.charAt(Math.floor(Math.random() * charset.length))).join('')
}

export function returnPage(type: TemplateName, data: TemplateData): Response {
    return new Response(TEMPL[type](data), {
        headers: {
            'content-type': 'text/html;charset=UTF-8',
        },
    })
}

export function returnJSON(code: number, data?: unknown, headers: HeadersInit = {}): Response {
    const successTempl = {
        err: 0,
        msg: 'ok',
        ...(data !== undefined && data !== null ? { data } : {}),
    }
    const errTempl = {
        err: code,
        msg: typeof data === 'string' ? data : JSON.stringify(data),
    }
    const ret = code ? errTempl : successTempl
    return new Response(JSON.stringify(ret), {
        headers: {
            'content-type': 'application/json;charset=UTF-8',
            ...headers,
        },
    })
}

export function returnRaw(data: string): Response {
    return new Response(data, {
        headers: {
            'content-type': 'text/plain;charset=UTF-8',
        },
    })
}

export function isJSONRequest(request: Request): boolean {
    return (request.headers.get('Content-Type') || '').includes('application/json')
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
    const matches = hex.match(/.{1,2}/g) || []
    return new Uint8Array(matches.map(byte => parseInt(byte, 16))) as Uint8Array<ArrayBuffer>
}

async function digestHex(algorithm: AlgorithmIdentifier, value: string): Promise<string> {
    const msgUint8 = new TextEncoder().encode(String(value))
    const hashBuffer = await crypto.subtle.digest(algorithm, msgUint8)
    return bytesToHex(new Uint8Array(hashBuffer))
}

async function legacySaltPw(password: string): Promise<string> {
    const hashPw = await digestHex('MD5', password)
    return digestHex('MD5', `${hashPw}+${LEGACY_SALT}`)
}

async function pbkdf2(password: string, saltHex: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
    const baseKey = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveBits']
    )
    const derived = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            hash: { name: PBKDF2_HASH },
            salt: hexToBytes(saltHex),
            iterations,
        },
        baseKey,
        PBKDF2_KEY_LENGTH
    )
    return bytesToHex(new Uint8Array(derived))
}

export async function saltPw(password: string): Promise<string> {
    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)))
    const hash = await pbkdf2(String(password), salt)
    return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`
}

export async function verifyPassword(password: string, storedPassword?: string): Promise<boolean> {
    if (typeof password !== 'string' || !storedPassword) {
        return false
    }

    if (storedPassword.startsWith('pbkdf2$')) {
        const [, iterations, salt, expectedHash] = storedPassword.split('$')
        if (!iterations || !salt || !expectedHash) {
            return false
        }
        const actualHash = await pbkdf2(password, salt, Number(iterations))
        return actualHash === expectedHash
    }

    return await legacySaltPw(password) === storedPassword
}

export async function checkAuth(cookie: AuthCookie, path: string): Promise<boolean> {
    if (!cookie.auth) {
        return false
    }

    try {
        const valid = await jwt.verify(cookie.auth, SECRET)
        if (!valid) {
            return false
        }

        const body = jwt.decode(cookie.auth) as { payload?: { path?: string } } | null
        return body?.payload?.path === path || false
    } catch (error) {
        console.error('JWT verify failed', error)
        return false
    }
}

export async function queryNote(key: string): Promise<QueryNoteResult> {
    const result = await NOTES.getWithMetadata(key)
    return {
        value: result.value || '',
        metadata: (result.metadata as QueryNoteResult['metadata']) || {},
    }
}

export function getI18n(request: Request): LanguageCode {
    const defaultLang: LanguageCode = 'en'
    const acceptLanguage = request.headers.get('Accept-Language') || defaultLang
    const acceptList = acceptLanguage.split(',').map(lang => lang.split(';')[0].trim().toLowerCase())

    for (const lang of acceptList) {
        const baseLang = lang.split('-')[0] as LanguageCode
        if (lang in SUPPORTED_LANG) {
            return lang as LanguageCode
        }
        if (baseLang in SUPPORTED_LANG) {
            return baseLang
        }
    }

    return defaultLang
}
