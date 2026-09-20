#!/usr/bin/env node
/**
 * Repair metadata ↔ body inconsistencies via POST /api/repair
 *
 * Examples:
 *   BASE_URL=https://notes.dayti.de npm run repair -- network_concepts
 *   BASE_URL=https://notes.dayti.de npm run repair -- network_concepts
 *   BASE_URL=https://notes.dayti.de npm run repair -- network_concepts --prefer title
 *   BASE_URL=https://notes.dayti.de npm run repair -- network_concepts --create-missing
 *   BASE_URL=https://notes.dayti.de npm run repair -- --all --limit 30
 *
 * Default prefer=h1: markdown body (H1 / book TOC) is the baseline for metadata.
 */

const base = process.env.BASE_URL || 'http://127.0.0.1:8799'
const args = process.argv.slice(2)
let path = null
let all = false
let prefer = 'h1'
let createMissing = false
let rebuildToc = true
let limit = 50

for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--all') all = true
  else if (a === '--prefer') prefer = args[++i] || 'h1'
  else if (a === '--create-missing') createMissing = true
  else if (a === '--no-rebuild-toc') rebuildToc = false
  else if (a === '--limit') limit = Number(args[++i] || 50)
  else if (!a.startsWith('--')) path = a
}

const url = new URL('/api/repair', base)
if (all) url.searchParams.set('all', '1')
else if (path) url.searchParams.set('path', path)
else {
  console.error('Usage: repair <path> | repair --all')
  process.exit(1)
}
url.searchParams.set('prefer', prefer)
if (rebuildToc) url.searchParams.set('rebuildToc', '1')
if (createMissing) url.searchParams.set('createMissing', '1')
if (all) url.searchParams.set('limit', String(limit))

console.log(`[repair] POST ${url}`)
const res = await fetch(url, { method: 'POST' })
const text = await res.text()
console.log(`[repair] status ${res.status}`)
console.log(text)

try {
  const json = JSON.parse(text)
  if (json.code !== 0) process.exit(1)
  const items = json.data?.results || [json.data]
  for (const item of items) {
    if (!item) continue
    console.log(
      `- ${item.path} type=${item.docType} changes=${(item.changes || []).length} tocRebuilt=${item.tocRebuilt} pages=${item.pagesCreated}/${item.pagesChecked}`
    )
    for (const c of item.changes || []) {
      console.log(`    ${c.kind}: ${c.detail}`)
    }
  }
} catch {
  process.exit(1)
}
