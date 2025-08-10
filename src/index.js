import dayjs from 'dayjs'
import {Router} from 'itty-router'
import Cookies from 'cookie'
import jwt from '@tsndr/cloudflare-worker-jwt'
import {checkAuth, genRandomStr, getI18n, queryNote, returnJSON, returnPage, returnRaw, saltPw} from './helper'
import {SECRET} from './constant'

// init
const router = Router()



router.get('/.create', () => {
    const newHash = genRandomStr(5)
    console.log(`Create new note: ${newHash}`)
    // redirect to new page
    return new Response(null, {
        status: 301,
        headers: {
            'Location': '/' + newHash + '/edit',
        }
    });
})

const indexPath = '.index';

router.get('/', async (request) => {
    const lang = getI18n(request)
    const {value, metadata} = await queryNote(indexPath)
    // redirect to new page
    return returnPage('Share', {
        lang,
        title: 'Cloud Notepad',
        content: value,
        ext: metadata,
    })
})

router.get('/:path', async (request) => {
    const lang = getI18n(request)
    const { path } = request.params

    if (!!path) {
        const { value, metadata } = await queryNote(path)

        return returnPage('Share', {
            lang,
            title: decodeURIComponent(path),
            content: value,
            ext: metadata,
        })
    }

    return returnPage('Page404', { lang, title: '404' })
})

router.get('/:path/edit', async (request) => {
    const lang = getI18n(request)

    const { path } = request.params
    const title = decodeURIComponent(path)

    const cookie = Cookies.parse(request.headers.get('Cookie') || '')

    const { value, metadata } = await queryNote(path)

    if (!metadata.pw) {
        return returnPage('Edit', {
            lang,
            title,
            content: value,
            ext: metadata,
        })
    }

    const valid = await checkAuth(cookie, path)
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

router.post('/:path/edit/auth', async request => {
    const { path } = request.params
    if (request.headers.get('Content-Type') === 'application/json') {
        const { passwd } = await request.json()

        const { metadata } = await queryNote(path)

        if (metadata.pw) {
            const storePw = await saltPw(passwd)

            if (metadata.pw === storePw) {
                const token = await jwt.sign({ path }, SECRET)
                return returnJSON(0, {
                    refresh: true,
                }, {
                    'Set-Cookie': Cookies.serialize('auth', token, {
                        path: `/${path}`,
                        expires: dayjs().add(7, 'day').toDate(),
                        httpOnly: true,
                    })
                })
            }
        }
    }

    return returnJSON(10002, 'Password auth failed!')
})

router.post('/:path/edit/pw', async request => {
    const { path } = request.params
    if (request.headers.get('Content-Type') === 'application/json') {
        const cookie = Cookies.parse(request.headers.get('Cookie') || '')
        const { passwd } = await request.json()

        const { value, metadata } = await queryNote(path)
        const valid = await checkAuth(cookie, path)

        if (!metadata.pw || valid) {
            const pw = passwd ? await saltPw(passwd) : undefined
            try {
                await NOTES.put(path, value, {
                    metadata: {
                        ...metadata,
                        pw,
                    },
                })

                return returnJSON(0, null, {
                    'Set-Cookie': Cookies.serialize('auth', '', {
                        path: `/${path}`,
                        expires: dayjs().subtract(100, 'day').toDate(),
                        httpOnly: true,
                    })
                })
            } catch (error) {
                console.error(error)
            }
        }

        return returnJSON(10003, 'Password setting failed!')
    }
})

router.post('/:path/edit/setting', async request => {
    const { path } = request.params
    if (request.headers.get('Content-Type') === 'application/json') {
        const cookie = Cookies.parse(request.headers.get('Cookie') || '')
        const { mode, share } = await request.json()

        const { value, metadata } = await queryNote(path)
        const valid = await checkAuth(cookie, path)

        if (!metadata.pw || valid) {
            try {
                await NOTES.put(path, value, {
                    metadata: {
                        ...metadata,
                        ...mode !== undefined && { mode },
                        ...share !== undefined && { share },
                    },
                })

/*                const md5 = await MD5(path)
                if (share) {
                    await SHARE.put(md5, path)
                    return returnJSON(0, md5)
                }
                if (share === false) {
                    await SHARE.delete(md5)
                }*/


                return returnJSON(0)
            } catch (error) {
                console.error(error)
            }
        }

        return returnJSON(10004, 'Update Setting failed!')
    }
})

router.post('/:path/edit', async request => {
    const { path } = request.params
    const { value, metadata } = await queryNote(path)

    const cookie = Cookies.parse(request.headers.get('Cookie') || '')
    const valid = await checkAuth(cookie, path)

    if (!metadata.pw || valid) {
        // OK
    } else {
        return returnJSON(10002, 'Password auth failed! Try refreshing this page if you had just set a password.')
    }

    const formData = await request.formData();
    const content = formData.get('t')

    try {

        if (content?.trim()){
            // 有值修改
            await NOTES.put(path, content, {
                metadata: {
                    ...metadata,
                    updateAt: dayjs().unix(),
                },
            })
        }else{
            // 无值删除
            await NOTES.delete(path)
        }

        return returnJSON(0)
    } catch (error) {
        console.error(error)
    }

    return returnJSON(10001, 'KV insert fail!')
})
router.get('/:path/raw', async (request) => {

    const {path} = request.params
    const url = new URL(request.url)
    const password = url.searchParams.get('password')

    const {value, metadata} = await queryNote(path)

    if (!metadata.pw || await saltPw(password) === metadata.pw) {
        return returnRaw(value)
    }
    return new Response('Forbidden', { status: 403 })
})

router.all('*', (request) => {
    const lang = getI18n(request)
    returnPage('Page404', { lang, title: '404' })
})

addEventListener('fetch', event => {
    event.respondWith(router.handle(event.request))
})