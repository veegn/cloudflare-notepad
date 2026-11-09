import { test, expect } from '@playwright/test'
import { saveNote, uniqueNotePath } from './helpers'

test('protected note requires auth for view and raw, then allows access after auth', async ({ page, request }) => {
    const notePath = uniqueNotePath()

    await saveNote(request, notePath, 'secret body')
    await request.patch(`/api/notes/${notePath}`, {
        data: { password: 's3cret-pass' },
    })

    // The PATCH request above sets a cookie in the context. Send an explicit bogus cookie to simulate an unauthenticated user.
    const rawBeforeAuth = await request.get(`/api/notes/${notePath}?raw=1`, { headers: { 'Cookie': '' } })
    expect(rawBeforeAuth.status()).toBe(403)
    await page.goto(`/note/${notePath}`)
    await expect(page.getByText(/protected/i)).toBeVisible()

    const authResponse = await request.post(`/api/auth`, {
        data: { path: notePath, password: 's3cret-pass' },
    })
    expect(authResponse.ok()).toBeTruthy()

    const rawAfterAuth = await request.get(`/api/notes/${notePath}?raw=1`)
    expect(rawAfterAuth.status()).toBe(200)
    await expect(rawAfterAuth.text()).resolves.toContain('secret body')
})

test('both raw routes return plain text for authorized and unauthorized requests', async ({ request }) => {
    const notePath = uniqueNotePath()
    const content = '笔记原文\n<script>source</script>\n'
    const headers = { Cookie: '' }

    await saveNote(request, notePath, content)
    await request.patch(`/api/notes/${notePath}`, {
        data: { password: 'url-pass' },
    })

    for (const prefix of ['/api/notes', '/note']) {
        const url = `${prefix}/${notePath}?raw=1`
        const denied = await request.get(url, { headers, maxRedirects: 0 })
        expect(denied.status()).toBe(403)
        expect(denied.headers()['content-type']).toBe('text/plain; charset=utf-8')
        expect(await denied.text()).toBe('Authorization required')

        const allowed = await request.get(`${url}&password=url-pass`, { headers })
        expect(allowed.status()).toBe(200)
        expect(allowed.headers()['content-type']).toBe('text/plain; charset=utf-8')
        expect(await allowed.text()).toBe(content)
    }
})

test.describe('password forms without JavaScript', () => {
    test.use({ javaScriptEnabled: false })

    test('can retry an incorrect password and unlock the reading and editing pages', async ({ page, request, context }) => {
        const notePath = uniqueNotePath()
        const content = 'password form body'
        const password = '密码 + & %'
        await saveNote(request, notePath, content)
        await request.patch(`/api/notes/${notePath}`, { data: { password } })

        for (const prefix of ['/note', '/edit']) {
            const url = `${prefix}/${notePath}`
            await context.clearCookies()
            await page.goto(url, { waitUntil: 'domcontentloaded' })

            const input = page.getByLabel('Enter the note password')
            await input.fill('wrong password')
            await input.press('Enter')
            await expect(page.getByRole('alert')).toHaveText('Password authentication failed.')

            await input.fill(password)
            await input.press('Enter')
            await expect(page).toHaveURL(new RegExp(`${url}$`))
            await expect(input).toHaveCount(0)

            const raw = await page.request.get(`/api/notes/${notePath}?raw=1`)
            expect(raw.status()).toBe(200)
            expect(await raw.text()).toBe(content)
        }
    })
})

test('.index edit is protected by admin password while home page stays viewable', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: /Edit Home|操作文档|Operations guide/ })).toBeVisible()

    await page.goto('/edit/_index')
    await expect(page.getByText(/protected/i)).toBeVisible()
})

test('can set a password via UI and it protects the note', async ({ page, request, context }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    // Click the Set Password button
    await page.locator('.opt-pw').click()

    // Handle custom DOM dialog
    await page.locator('.modal-input').fill('my-new-pass')
    await page.locator('.modal-btn-primary').click()

    // Handle the custom success alert ("Password saved")
    await page.locator('.modal-desc').waitFor({ state: 'visible' })
    await page.locator('.modal-btn-primary').click()
    
    // Wait for the page to reload
    await page.waitForURL(url => url.pathname.includes('/edit/'))

    // After setting the password, we should still be authorized to edit since we just set it
    await expect(page.locator('.cm-editor')).toBeVisible()

    // But if we fetch raw via request (no cookie), it should be forbidden
    const rawWithoutPassword = await request.get(`/api/notes/${notePath}?raw=1`, { headers: { 'Cookie': '' } })
    expect(rawWithoutPassword.status()).toBe(403)

    // And if we visit the note view page without a cookie, we should see the auth prompt
    await context.clearCookies()
    await page.goto(`/note/${notePath}`)
    await expect(page.getByText(/protected/i)).toBeVisible()
})
