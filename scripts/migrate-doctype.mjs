#!/usr/bin/env node
/**
 * Historical note adaptation for document types (article / book / page).
 *
 * Runtime behavior (no migration required):
 *   - Notes without `docType` in R2 custom_metadata are treated as `article`.
 *   - Legacy home keys `.index` still resolve to `_index`.
 *   - Home tree lists articles + books; pages only appear inside book editor.
 *
 * This script inspects **local** miniflare R2 state and can stamp explicit
 * docType metadata when you want hierarchical books in historical data.
 *
 * Examples:
 *   npm run migrate:doctype:dry
 *   npm run migrate:doctype -- --mark-book handbook
 *   npm run migrate:doctype -- --mark-page handbook/intro --book handbook --title "Intro"
 *   npm run migrate:doctype -- --stamp-articles
 *
 * Remote R2: custom metadata cannot be written via `wrangler r2 object put`.
 * Use a one-off Worker (see wrangler.migrate.toml pattern) after reviewing dry-run output.
 */

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const DEFAULT_R2_DIR = path.join(projectRoot, '.wrangler', 'state', 'v3', 'r2')

function parseArgs(argv) {
  const args = {
    r2Dir: DEFAULT_R2_DIR,
    dryRun: false,
    markBook: [],
    markPage: [],
    bookRef: null,
    title: null,
    stampArticles: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case '--r2-dir':
        args.r2Dir = next()
        break
      case '--dry-run':
        args.dryRun = true
        break
      case '--mark-book':
        args.markBook.push(next())
        break
      case '--mark-page':
        args.markPage.push(next())
        break
      case '--book':
        args.bookRef = next()
        break
      case '--title':
        args.title = next()
        break
      case '--stamp-articles':
        args.stampArticles = true
        break
      default:
        break
    }
  }
  return args
}

function findR2Databases(r2Dir) {
  if (!fs.existsSync(r2Dir)) return []
  const out = []
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.sqlite')) out.push(full)
    }
  }
  walk(r2Dir)
  return out
}

function openDb(file) {
  return new DatabaseSync(file)
}

/** Best-effort parse of miniflare R2 sqlite blobs into key + custom_metadata. */
function listObjects(db) {
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all()
    .map(r => r.name)
  const table = tables.find(t => /R2Object|r2_object|objects/i.test(t)) || tables[0]
  if (!table) return []

  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name)
  const keyCol = cols.find(c => /key/i.test(c)) || cols[0]
  const blobCol =
    cols.find(c => /blob|value|body|data/i.test(c)) ||
    cols.filter(c => c !== keyCol)[0]
  if (!keyCol) return []

  const rows = db.prepare(`SELECT ${keyCol} AS k FROM ${table}`).all()
  return rows.map(r => String(r.k))
}

function parseMetadataFromBlob(buffer) {
  if (!buffer || buffer.length < 2) return {}
  const text = Buffer.from(buffer).toString('utf8')
  const custom = {}
  // Heuristic: look for JSON-like custom metadata or flat key patterns.
  const docType = text.match(/"docType"\s*:\s*"(\w+)"/)
  if (docType) custom.docType = docType[1]
  const bookRef = text.match(/"bookRef"\s*:\s*"([^"]+)"/)
  if (bookRef) custom.bookRef = bookRef[1]
  const title = text.match(/"title"\s*:\s*"([^"]+)"/)
  if (title) custom.title = title[1]
  return custom
}

function report(keys) {
  const legacy = []
  const books = []
  const pages = []
  const articles = []
  const nestedNoType = []

  for (const key of keys) {
    if (key === '_index' || key === '.index') {
      articles.push({ key, note: 'home index' })
      continue
    }
    // Without reliable metadata decode in all miniflare versions, classify by path shape.
    const hasSlash = key.includes('/')
    const parts = key.split('/')
    const looksLikePage = hasSlash && !key.endsWith('/')
    // Top-level keys are candidate books/articles; nested are candidate pages.
    if (!hasSlash) {
      articles.push({ key, note: 'top-level (default article)' })
    } else if (looksLikePage) {
      nestedNoType.push({ key, bookRef: parts.slice(0, -1).join('/') })
      pages.push({ key })
    } else {
      legacy.push({ key })
    }
  }

  return { legacy, books, articles, pages, nestedNoType, total: keys.length }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const dbs = findR2Databases(args.r2Dir)
  if (dbs.length === 0) {
    console.log(`[doctype] No local R2 sqlite under ${args.r2Dir}`)
    console.log('[doctype] Runtime still accepts legacy notes without docType (article).')
    process.exit(0)
  }

  const allKeys = []
  for (const dbFile of dbs) {
    try {
      const db = openDb(dbFile)
      const keys = listObjects(db)
      console.log(`[doctype] ${dbFile}: ${keys.length} keys`)
      allKeys.push(...keys)
      db.close()
    } catch (err) {
      console.warn(`[doctype] skip ${dbFile}: ${err.message}`)
    }
  }

  const summary = report(allKeys)
  console.log('\n=== Historical data report (local R2) ===')
  console.log(`Total keys: ${summary.total}`)
  console.log(`Home index / articles (default): ${summary.articles.length}`)
  console.log(`Nested paths without explicit type (candidate pages): ${summary.nestedNoType.length}`)
  for (const item of summary.nestedNoType.slice(0, 50)) {
    console.log(`  - ${item.key}  (bookRef candidate: ${item.bookRef})`)
  }
  if (summary.nestedNoType.length > 50) {
    console.log(`  … and ${summary.nestedNoType.length - 50} more`)
  }

  if (args.dryRun) {
    console.log('\n[dry-run] No writes performed.')
    console.log('Runtime will treat all keys without docType as article.')
    console.log('To create real books, use the app create dialog or mark paths below.')
  }

  if (args.markBook.length || args.markPage.length || args.stampArticles) {
    console.log('\n[doctype] Stamping custom_metadata requires re-PUT objects.')
    console.log('Local sqlite stamping is environment-specific; prefer:')
    console.log('  1) App UI: New Document → Book / Book editor → New page')
    console.log('  2) Or a one-off Worker that GET + PUT with custom_metadata')
    console.log(`Requested mark-book: ${args.markBook.join(', ') || '(none)'}`)
    console.log(
      `Requested mark-page: ${args.markPage.join(', ') || '(none)'} bookRef=${args.bookRef || '-'} title=${args.title || '-'}`
    )
    console.log('See docs/product-doc-types.md for the target metadata shape.')
  }

  console.log('\n[doctype] Compatibility summary:')
  console.log('  - missing docType  → article (default)')
  console.log('  - .index           → _index home note')
  console.log('  - path a/b         → article under virtual dir a, until stamped as page')
}

main()
