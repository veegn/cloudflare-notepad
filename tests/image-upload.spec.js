const { test, expect } = require('@playwright/test')
const { uniqueNotePath, saveNote } = require('./helpers')

function tinyPng() {
  // 1x1 PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
}

test('upload image returns asset url and serves bytes', async ({ request }) => {
  const notePath = uniqueNotePath()
  await saveNote(request, notePath, '# Upload test\n')

  const png = tinyPng()
  const res = await request.post(`/api/upload?note=${notePath}`, {
    headers: {
      'Content-Type': 'image/png',
      'X-Filename': 'pixel.png',
    },
    data: png,
  })
  expect(res.ok()).toBeTruthy()
  const json = await res.json()
  expect(json.code).toBe(0)
  expect(json.data.url).toMatch(/^\/assets\//)
  expect(json.data.markdown).toContain('![pixel](')
  expect(json.data.markdown).toContain(json.data.url)

  const asset = await request.get(json.data.url)
  expect(asset.ok()).toBeTruthy()
  expect(asset.headers()['content-type']).toContain('image/png')
  const body = await asset.body()
  expect(body.length).toBe(png.length)
})

test('upload rejects unsupported content type', async ({ request }) => {
  const res = await request.post('/api/upload', {
    headers: { 'Content-Type': 'text/plain' },
    data: 'not-an-image',
  })
  expect(res.status()).toBe(400)
})

test('markdown editor shows image upload control', async ({ page, request }) => {
  const notePath = uniqueNotePath()
  await saveNote(request, notePath, '# Image note\n\n')
  // switch to md via PATCH
  await request.patch(`/api/notes/${notePath}`, {
    data: { mode: 'md' },
  })

  await page.goto(`/edit/${notePath}`)
  await expect(page.locator('#btn-upload-image-md')).toBeVisible()
  // hidden file input is created on click; paste handler exists on editor host
  await expect(page.locator('#cm-editor')).toBeVisible()
})
