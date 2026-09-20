#!/usr/bin/env node
/**
 * Delete e2e residual objects from a notepad R2 bucket (via HTTP API).
 *
 * Local:
 *   BASE_URL=http://127.0.0.1:8799 npm run cleanup:e2e
 *
 * Production (after deploy):
 *   BASE_URL=https://notes.dayti.de npm run cleanup:e2e
 *
 * Dry-run (default lists only):
 *   BASE_URL=https://notes.dayti.de npm run cleanup:e2e -- --dry-run
 *
 * Force delete:
 *   BASE_URL=https://notes.dayti.de npm run cleanup:e2e -- --force
 */

const base = process.env.BASE_URL || 'http://127.0.0.1:8799'
const args = process.argv.slice(2)
const dryRun = !args.includes('--force') || args.includes('--dry-run')
const force = args.includes('--force') && !args.includes('--dry-run')

const prefixes = ['e2e-', 'e2ebook-', 'e2edir-', 'e2etree-', 'e2ebook_', 'hb-demo']

function isE2ePath(path) {
  return prefixes.some(p => path.startsWith(p))
}

async function listPaths(prefix) {
  const url = new URL('/api/notes', base)
  url.searchParams.set('docType', 'all')
  url.searchParams.set('excludePages', '0')
  url.searchParams.set('limit', '200')
  if (prefix) url.searchParams.set('prefix', prefix)
  const res = await fetch(url)
  const text = await res.text()
  if (!text.trim().startsWith('{')) {
    console.log(`[cleanup] skip non-JSON prefix=${prefix || '(all)'} status=${res.status}`)
    return []
  }
  const json = JSON.parse(text)
  return (json?.data?.items || []).map(i => i.path).filter(Boolean)
}

async function deletePath(path) {
  const res = await fetch(
    new URL(`/api/notes/${path.split('/').map(encodeURIComponent).join('/')}`, base),
    { method: 'DELETE' },
  )
  return res.status
}

console.log(`[cleanup] BASE_URL=${base} mode=${force ? 'DELETE' : 'dry-run'}`)

const all = new Set()
for (const p of ['', ...prefixes]) {
  const paths = await listPaths(p)
  paths.forEach(x => all.add(x))
}

const targets = [...all].filter(isE2ePath).sort()
console.log(`[cleanup] candidates=${targets.length}`)
for (const p of targets.slice(0, 30)) console.log(' ', p)
if (targets.length > 30) console.log(`  … +${targets.length - 30} more`)

if (!force) {
  console.log('[cleanup] dry-run only. Re-run with --force to delete.')
  process.exit(0)
}

let ok = 0
let fail = 0
for (const path of targets) {
  const status = await deletePath(path)
  if (status >= 200 && status < 300) ok += 1
  else {
    fail += 1
    console.log(`  fail ${status} ${path}`)
  }
}
console.log(`[cleanup] deleted=${ok} failed=${fail}`)

// drop structured caches
try {
  // touch home-tree to force rebuild via a harmless list read
  await fetch(new URL('/api/home-tree', base))
} catch {
  /* ignore */
}
