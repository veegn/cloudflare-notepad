const { test, expect } = require('@playwright/test')
const { saveNote, uniqueNotePath } = require('./helpers')

test('protected note requires auth for view and raw, then allows access after auth', async ({ page, request }) => {
    const notePath = uniqueNotePath()

    await saveNote(request, notePath, 'secret body')
    await request.post(`${notePath}/edit/pw`, {
        data: { passwd: 's3cret-pass' },
    })

    const rawBeforeAuth = await request.get(`${notePath}/raw`)
    expect(rawBeforeAuth.status()).toBe(403)

    await page.goto(notePath)
    await expect(page.getByText(/protected/i)).toBeVisible()

    const authResponse = await request.post(`${notePath}/edit/auth`, {
        data: { passwd: 's3cret-pass' },
    })
    expect(authResponse.ok()).toBeTruthy()

    const rawAfterAuth = await request.get(`${notePath}/raw`)
    expect(rawAfterAuth.status()).toBe(200)
    await expect(rawAfterAuth.text()).resolves.toContain('secret body')
})

test('protected raw route accepts password from url query', async ({ request }) => {
    const notePath = uniqueNotePath()

    await saveNote(request, notePath, 'query password body')
    await request.post(`${notePath}/edit/pw`, {
        data: { passwd: 'url-pass' },
    })

    const rawWithoutPassword = await request.get(`${notePath}/raw`)
    expect(rawWithoutPassword.status()).toBe(403)

    const rawWithPassword = await request.get(`${notePath}/raw?password=url-pass`)
    expect(rawWithPassword.status()).toBe(200)
    await expect(rawWithPassword.text()).resolves.toContain('query password body')
})

test('.index edit is protected by admin password while home page stays viewable', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Edit Home' })).toBeVisible()

    await page.goto('/.index/edit')
    await expect(page.getByText(/protected/i)).toBeVisible()
})
