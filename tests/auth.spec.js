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

test('.index edit is protected by admin password while home page stays viewable', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Edit Home' })).toBeVisible()

    await page.goto('/.index/edit')
    await expect(page.getByText(/protected/i)).toBeVisible()
})
