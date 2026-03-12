import Cookies, { type CookieSerializeOptions } from 'cookie'
import jwt from '@tsndr/cloudflare-worker-jwt'
import { INDEX_EDIT_PASSWORD, SECRET } from './constant'
import { checkAuth, verifyPassword } from './helper'
import type { NoteMetadata } from './types'

export const authCookieName = 'auth'
export const authMaxAgeSeconds = 7 * 24 * 60 * 60
export const indexPath = '.index'

export function getCookieOptions(request: Request, path: string, expiresAt: Date): CookieSerializeOptions {
    const protocol = new URL(request.url).protocol
    return {
        path: `/${path}`,
        expires: expiresAt,
        httpOnly: true,
        sameSite: 'strict',
        secure: protocol === 'https:',
    }
}

export function needsViewAuth(metadata: NoteMetadata): boolean {
    return Boolean(metadata?.pw || metadata?.share === false)
}

function getRequestPassword(request: Request): string | undefined {
    const { searchParams } = new URL(request.url)
    return searchParams.get('password') || searchParams.get('passwd') || searchParams.get('pw') || undefined
}

export function requiresEditAuth(path: string, metadata: NoteMetadata): boolean {
    if (path === indexPath && INDEX_EDIT_PASSWORD) {
        return true
    }
    return Boolean(metadata?.pw)
}

export async function isAuthorized(request: Request, path: string, metadata: NoteMetadata): Promise<boolean> {
    if (!needsViewAuth(metadata)) {
        return true
    }

    const requestPassword = getRequestPassword(request)
    if (metadata.pw && requestPassword && await verifyPassword(requestPassword, metadata.pw)) {
        return true
    }

    const cookie = Cookies.parse(request.headers.get('Cookie') || '')
    return checkAuth(cookie, path)
}

export async function isEditAuthorized(request: Request, path: string, metadata: NoteMetadata): Promise<boolean> {
    if (!requiresEditAuth(path, metadata)) {
        return true
    }
    const cookie = Cookies.parse(request.headers.get('Cookie') || '')
    return checkAuth(cookie, path)
}

export async function matchesEditPassword(path: string, passwd: string | undefined, metadata: NoteMetadata): Promise<boolean> {
    const matchesNotePassword = Boolean(metadata.pw && passwd && await verifyPassword(passwd, metadata.pw))
    const matchesIndexEditPassword = Boolean(path === indexPath && INDEX_EDIT_PASSWORD && passwd === INDEX_EDIT_PASSWORD)
    return matchesNotePassword || matchesIndexEditPassword
}

export async function createAuthToken(path: string): Promise<string> {
    return jwt.sign({
        path,
        exp: Math.floor(Date.now() / 1000) + authMaxAgeSeconds,
    }, SECRET)
}
