/**
 * One-off Cloudflare Worker: rewrite notes KV → R2
 * body = pure content, metadata flattened in customMetadata
 * (pw / mode / updateAt / share — all string values)
 *
 * Bindings (see wrangler.migrate.toml):
 *   NOTES_KV  — historical Workers KV namespace
 *   NOTES_R2  — target R2 bucket
 */

const LEGACY_INDEX = '.index'
const INDEX_PATH = '_index'

function normalizeMetadata(meta) {
  const out = { ...(meta || {}) }
  if (out.pw === null || out.pw === undefined || out.pw === '') delete out.pw
  if (out.share === true) delete out.share
  if (out.mode === 'plain') delete out.mode
  return out
}

function flattenCustomMetadata(metadata) {
  const custom = {}
  if (metadata && metadata.pw) custom.pw = String(metadata.pw)
  if (metadata && metadata.mode && metadata.mode !== 'plain') custom.mode = String(metadata.mode)
  if (metadata && metadata.updateAt != null) custom.updateAt = String(metadata.updateAt)
  if (metadata && metadata.share === false) custom.share = 'false'
  return custom
}

function parseStoredBody(value, externalMeta) {
  let metadata = { ...(externalMeta || {}) }
  let content = value ?? ''
  if (typeof content !== 'string') content = String(content)

  // Historical KV formats (flush source only — runtime no longer reads these).
  if (content.startsWith('\0META:')) {
    const end = content.indexOf('\0\n')
    if (end !== -1) {
      try {
        metadata = { ...metadata, ...JSON.parse(content.slice(6, end)) }
      } catch {
        /* ignore */
      }
      content = content.slice(end + 2)
    }
  } else if (content.startsWith('{')) {
    try {
      const blob = JSON.parse(content)
      if (blob && typeof blob === 'object' && typeof blob.content === 'string') {
        metadata = { ...(blob.metadata || {}), ...metadata }
        content = blob.content
      }
    } catch {
      /* pure JSON note content */
    }
  }

  return { content, metadata: normalizeMetadata(metadata) }
}

async function listAllKvKeys(kv) {
  const keys = []
  let cursor
  for (;;) {
    const page = await kv.list(cursor ? { cursor } : {})
    for (const k of page.keys || []) keys.push(k.name)
    if (page.list_complete === false && page.cursor) {
      cursor = page.cursor
      continue
    }
    break
  }
  return keys
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url)

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return Response.json({ ok: true, service: 'cloudflare-notepad-migrate' })
    }

    if (url.pathname === '/flush' && req.method === 'POST') {
      const keys = await listAllKvKeys(env.NOTES_KV)
      const results = []
      let migrated = 0
      let skipped = 0
      let failed = 0

      for (const key of keys) {
        try {
          const { value, metadata: kvMeta } = await env.NOTES_KV.getWithMetadata(key, 'text')
          if (value == null) {
            skipped++
            results.push({ key, status: 'missing-value' })
            continue
          }
          const parsed = parseStoredBody(value, kvMeta)
          const outKey = key
          if (!String(parsed.content || '').trim()) {
            skipped++
            results.push({ key, status: 'empty' })
            continue
          }
          const customMetadata = flattenCustomMetadata(parsed.metadata)
          await env.NOTES_R2.put(outKey, parsed.content, {
            httpMetadata: { contentType: 'text/plain; charset=utf-8' },
            customMetadata,
          })
          migrated++
          results.push({
            key,
            outKey,
            status: 'migrated',
            metadata: parsed.metadata,
            customMetadata,
            contentLength: String(parsed.content).length,
          })
        } catch (e) {
          failed++
          results.push({ key, status: `failed: ${e && e.message ? e.message : e}` })
        }
      }

      return Response.json({
        totalKeys: keys.length,
        migrated,
        skipped,
        failed,
        results,
      })
    }

    if (url.pathname === '/put' && req.method === 'POST') {
      const payload = await req.json()
      const { bucket, key, body, customMetadata, metadata } = payload || {}
      if (!key || body == null) {
        return Response.json({ error: 'key and body are required' }, { status: 400 })
      }
      void bucket
      const cm = customMetadata || flattenCustomMetadata(metadata || {})
      await env.NOTES_R2.put(key, body, {
        httpMetadata: { contentType: 'text/plain; charset=utf-8' },
        customMetadata: cm,
      })
      return Response.json({ ok: true, key, customMetadata: cm })
    }

    if (url.pathname === '/keys' && req.method === 'GET') {
      const keys = await listAllKvKeys(env.NOTES_KV)
      return Response.json({ count: keys.length, keys })
    }

    return new Response('Not found', { status: 404 })
  },
}
