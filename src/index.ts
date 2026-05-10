import { Router } from 'itty-router'
import Cookies from 'cookie'
import {
    genRandomStr,
    getI18n,
    isJSONRequest,
    queryNote,
    returnJSON,
    returnPage,
    returnRaw,
    saltPw,
} from './helper'
import { authMaxAgeSeconds, createAuthToken, getCookieOptions, indexPath, isAuthorized, isEditAuthorized, matchesEditPassword, requiresEditAuth } from './auth'
import { createEditMetadata, createPasswordMetadata, isIndexPath } from './note-service'
import type { NoteMode } from './types'

const router = Router()
const authCookieName = 'auth'

type RouteRequest = Request & { params: { path?: string } }

router.get('/.create', () => {
    const newHash = genRandomStr(5)
    return new Response(null, {
        status: 302,
        headers: {
            Location: `/${newHash}/edit`,
        },
    })
})

router.get('/.index', () => new Response(null, {
    status: 302,
    headers: {
        Location: '/',
    },
}))

router.get('/', async (request: Request) => {
    const lang = getI18n(request)
    const { value, metadata } = await queryNote(indexPath)

    return returnPage('Home', {
        lang,
        title: 'Cloud Notepad',
        content: value,
        ext: metadata,
    })
})

router.get('/:path', async (request: RouteRequest) => {
    const lang = getI18n(request)
    const { path } = request.params

    if (!path) {
        return returnPage('Page404', { lang, title: '404' })
    }

    if (isIndexPath(path)) {
        return new Response(null, {
            status: 302,
            headers: {
                Location: '/',
            },
        })
    }

    const { value, metadata } = await queryNote(path)
    const title = decodeURIComponent(path)

    if (metadata.share === false) {
        const valid = await isAuthorized(request, path, metadata)
        if (!valid) {
            return returnPage('NeedPasswd', { lang, title, tipKey: 'tipPrivate', showPwPrompt: Boolean(metadata.pw) })
        }
    } else if (metadata.pw) {
        const valid = await isAuthorized(request, path, metadata)
        if (!valid) {
            return returnPage('NeedPasswd', { lang, title })
        }
    }

    return returnPage('Share', {
        lang,
        title,
        content: value,
        ext: metadata,
    })
})

router.get('/:path/edit', async (request: RouteRequest) => {
    const lang = getI18n(request)
    const { path } = request.params
    const notePath = path || ''
    const title = decodeURIComponent(notePath)
    const { value, metadata } = await queryNote(notePath)

    if (!requiresEditAuth(notePath, metadata)) {
        return returnPage('Edit', {
            lang,
            title,
            content: value,
            ext: metadata,
        })
    }

    const valid = await isEditAuthorized(request, notePath, metadata)
    if (valid) {
        return returnPage('Edit', {
            lang,
            title,
            content: value,
            ext: metadata,
        })
    }

    return returnPage('NeedPasswd', { lang, title })
})

router.post('/:path/edit/auth', async (request: RouteRequest) => {
    const { path } = request.params
    const notePath = path || ''
    if (!isJSONRequest(request)) {
        return returnJSON(10002, 'Password auth failed!')
    }

    const { passwd } = await request.json<{ passwd?: string }>()
    const { metadata } = await queryNote(notePath)

    if (await matchesEditPassword(notePath, passwd, metadata)) {
        const token = await createAuthToken(notePath)

        return returnJSON(0, { refresh: true }, {
            'Set-Cookie': Cookies.serialize(
                authCookieName,
                token,
                getCookieOptions(request, notePath, new Date(Date.now() + authMaxAgeSeconds * 1000))
            ),
        })
    }

    return returnJSON(10002, 'Password auth failed!')
})

router.post('/:path/edit/pw', async (request: RouteRequest) => {
    try {
        const { path } = request.params
        const notePath = path || ''
        if (!isJSONRequest(request)) {
            return returnJSON(10003, 'Password setting failed!')
        }

    const { passwd } = await request.json<{ passwd?: string }>()
    const { value, metadata } = await queryNote(notePath)
    const valid = await isEditAuthorized(request, notePath, metadata)

    if (!requiresEditAuth(notePath, metadata) || valid) {
        const pw = passwd ? await saltPw(passwd) : undefined

        try {
            await NOTES.put(notePath, value, {
                metadata: createPasswordMetadata(metadata, pw),
            })

            return returnJSON(0, null, {
                'Set-Cookie': Cookies.serialize(
                    authCookieName,
                    '',
                    getCookieOptions(request, notePath, new Date(0))
                ),
            })
        } catch (error) {
            console.error(error)
        }
    }

        return returnJSON(10003, 'Password setting failed!')
    } catch (e: any) {
        return returnJSON(500, `Debug error: ${e?.name} - ${e?.message} - ${e?.stack}`)
    }
})

router.post('/:path/edit/setting', async (request: RouteRequest) => {
    const { path } = request.params
    const notePath = path || ''
    if (!isJSONRequest(request)) {
        return returnJSON(10004, 'Update setting failed!')
    }

    const { mode } = await request.json<{ mode?: NoteMode }>()
    const { value, metadata } = await queryNote(notePath)
    const valid = await isEditAuthorized(request, notePath, metadata)
    const allowedModes = new Set<NoteMode>(['plain', 'md', 'json', 'yaml'])

    if ((!requiresEditAuth(notePath, metadata) || valid) && (mode === undefined || allowedModes.has(mode))) {
        try {
            await NOTES.put(notePath, value, {
                metadata: createEditMetadata(metadata, value, mode),
            })
            return returnJSON(0)
        } catch (error) {
            console.error(error)
        }
    }

    return returnJSON(10004, 'Update setting failed!')
})

router.post('/:path/edit', async (request: RouteRequest) => {
    const { path } = request.params
    const notePath = path || ''
    const { metadata } = await queryNote(notePath)
    const valid = await isEditAuthorized(request, notePath, metadata)

    if (requiresEditAuth(notePath, metadata) && !valid) {
        return returnJSON(10002, 'Password auth failed! Try refreshing this page if you had just set a password.')
    }

    const formData = await request.formData()
    const content = formData.get('t')

    try {
        if (typeof content === 'string' && content.trim()) {
            await NOTES.put(notePath, content, {
                metadata: createEditMetadata(metadata, content),
            })
        } else {
            await NOTES.delete(notePath)
        }

        return returnJSON(0)
    } catch (error) {
        console.error(error)
    }

    return returnJSON(10001, 'KV insert failed!')
})

router.get('/:path/raw', async (request: RouteRequest) => {
    const { path } = request.params
    const notePath = path || ''
    const { value, metadata } = await queryNote(notePath)

    if (metadata.pw || metadata.share === false) {
        const valid = await isAuthorized(request, notePath, metadata)
        if (!valid) {
            return new Response('Forbidden', { status: 403 })
        }
    }

    return returnRaw(value)
})

router.all('*', (request: Request) => {
    const lang = getI18n(request)
    return returnPage('Page404', { lang, title: '404' })
})

addEventListener('fetch', ((event: Event) => {
    const fetchEvent = event as FetchEvent
    fetchEvent.respondWith(router.handle(fetchEvent.request))
}) as EventListener)
