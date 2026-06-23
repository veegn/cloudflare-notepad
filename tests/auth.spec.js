const { test, expect } = require('@playwright/test')
const { saveNote, uniqueNotePath } = require('./helpers')

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

test('protected raw route accepts password from url query', async ({ request }) => {
    const notePath = uniqueNotePath()

    await saveNote(request, notePath, 'query password body')
    await request.patch(`/api/notes/${notePath}`, {
        data: { password: 'url-pass' },
    })

    const rawWithoutPassword = await request.get(`/api/notes/${notePath}?raw=1`, { headers: { 'Cookie': '' } })
    expect(rawWithoutPassword.status()).toBe(403)

    const rawWithPassword = await request.get(`/api/notes/${notePath}?raw=1&password=url-pass`)
    expect(rawWithPassword.status()).toBe(200)
    await expect(rawWithPassword.text()).resolves.toContain('query password body')
})

test('.index edit is protected by admin password while home page stays viewable', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Edit Home' })).toBeVisible()

    await page.goto('/edit/_index')
    await expect(page.getByText(/protected/i)).toBeVisible()
})

test('can set a password via UI and it protects the note', async ({ page, request, context }) => {
    const notePath = uniqueNotePath()
    await page.goto(`/edit/${notePath}`)

    // Click the Set Password button
    await page.locator('.opt-pw').click()

    // Handle custom DOM dialog
    await page.locator('.pw-input').fill('my-new-pass')
    await page.locator('.pw-ok').click()

    // Handle the native success alert ("Password saved")
    page.once('dialog', dialog => dialog.accept())
    
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
