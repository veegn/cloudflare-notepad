const { test, expect } = require('@playwright/test')
const { uniqueNotePath, saveNote } = require('./helpers')

function tinyPng() {
  // 1x1 PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
}

test('upload image stores beside note and returns relative markdown', async ({ request }) => {
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
  // Sibling folder: {note}.assets/...
  expect(json.data.path).toContain('.assets/')
  expect(json.data.path.startsWith(`${notePath}.assets/`)).toBeTruthy()
  // Export-friendly relative markdown
  expect(json.data.relative).toMatch(/^\.\/[^/]+\.assets\//)
  expect(json.data.markdown).toContain(json.data.relative)
  // Web URL mirrors full R2 key under /assets/
  expect(json.data.url).toBe(`/assets/${json.data.path}`)

  const asset = await request.get(json.data.url)
  expect(asset.ok()).toBeTruthy()
  expect(asset.headers()['content-type']).toContain('image/png')
  const body = await asset.body()
  expect(body.length).toBe(png.length)
})

test('upload without note uses legacy _assets prefix', async ({ request }) => {
  const png = tinyPng()
  const res = await request.post('/api/upload', {
    headers: { 'Content-Type': 'image/png', 'X-Filename': 'a.png' },
    data: png,
  })
  expect(res.ok()).toBeTruthy()
  const json = await res.json()
  expect(json.data.path.startsWith('_assets/')).toBeTruthy()
  const asset = await request.get(json.data.url)
  expect(asset.ok()).toBeTruthy()
})

test('upload accepts UTF-8 filename via query name param', async ({ request }) => {
  const notePath = uniqueNotePath()
  await saveNote(request, notePath, '# utf8 name\n')
  const png = tinyPng()
  const res = await request.post(
    `/api/upload?note=${notePath}&name=${encodeURIComponent('中文图片.png')}`,
    {
      headers: {
        'Content-Type': 'image/png',
        'X-Filename': 'ascii-fallback.png',
      },
      data: png,
    },
  )
  expect(res.ok()).toBeTruthy()
  const json = await res.json()
  expect(json.code).toBe(0)
  expect(json.data.path).toContain('.assets/')
  // alt/markdown derived from decoded Chinese name → sanitized ascii stem or image
  expect(json.data.markdown).toMatch(/^!\[[^\]]+\]\(\.\/[^)]+\.assets\/[^)]+\)$/)
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
