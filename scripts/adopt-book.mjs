#!/usr/bin/env node
/**
 * Adopt a historical note path as a book via POST /api/books/:path/adopt
 *
 * Usage:
 *   npm run adopt:book -- network_concepts
 *   BASE_URL=https://your-worker npm run adopt:book -- network_concepts --title "网络概念"
 */

const base = process.env.BASE_URL || 'http://127.0.0.1:8799'
const args = process.argv.slice(2)
let book = 'network_concepts'
let title = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--title') title = args[++i]
  else if (!args[i].startsWith('--')) book = args[i]
}

const url = new URL(`/api/books/${encodeURIComponent(book)}/adopt`, base)
if (title) url.searchParams.set('title', title)

console.log(`[adopt] POST ${url}`)
const res = await fetch(url, { method: 'POST' })
const text = await res.text()
console.log(`[adopt] status ${res.status}`)
console.log(text)
try {
  const json = JSON.parse(text)
  if (json.code !== 0) process.exit(1)
  console.log(
    `[adopt] book=${json.data?.bookPath} pages=${json.data?.pagesAdopted}/${json.data?.pagesTotal}`
  )
} catch {
  process.exit(1)
}
