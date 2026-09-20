#!/usr/bin/env node
/**
 * Migrate historical Cloudflare Workers KV notes into R2 object storage.
 *
 * Requires Node.js 22+ (uses node:sqlite for local miniflare state).
 *
 * Default path is fully local:
 *   .wrangler/state/v3/kv/<namespace-id>/  →  .wrangler/state/v3/r2/<bucket>/
 *
 * Also supports wrangler CLI sources/targets for remote namespaces/buckets.
 *
 * Examples:
 *   npm run migrate:kv-to-r2:dry
 *   npm run migrate:kv-to-r2
 *   npm run migrate:kv-to-r2 -- --force
 *   npm run migrate:kv-to-r2 -- --target dump --out .temp/kv-dump
 *   npm run migrate:kv-to-r2 -- --source remote --target remote \
 *     --kv-namespace-id b485b873ed1a41d686bb26799e2eb527 --r2-bucket cloud-notepad-notes
 */

import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

const DEFAULT_KV_NAMESPACE_ID = 'b485b873ed1a41d686bb26799e2eb527'
const DEFAULT_R2_BUCKET = 'cloud-notepad-notes'
const LEGACY_INDEX = '.index'
const INDEX_PATH = '_index'

/** Flatten NoteMetadata into R2 custom_metadata string map. */
export function flattenCustomMetadata(metadata) {
  const custom = {}
  if (metadata && metadata.pw) custom.pw = String(metadata.pw)
  if (metadata && metadata.mode && metadata.mode !== 'plain') custom.mode = String(metadata.mode)
  if (metadata && metadata.updateAt != null) custom.updateAt = String(metadata.updateAt)
  if (metadata && metadata.share === false) custom.share = 'false'
  // Doc-type fields (new). Missing docType stays omitted → runtime treats as article.
  if (metadata && metadata.docType && metadata.docType !== 'article') {
    custom.docType = String(metadata.docType)
  }
  if (metadata && metadata.bookRef) custom.bookRef = String(metadata.bookRef)
  if (metadata && metadata.title) custom.title = String(metadata.title)
  return custom
}

function parseArgs(argv) {
  const args = {
    source: 'local',
    target: 'local',
    kvNamespaceId: DEFAULT_KV_NAMESPACE_ID,
    kvDir: null,
    r2Bucket: DEFAULT_R2_BUCKET,
    r2Dir: null,
    r2Db: null,
    out: path.join(projectRoot, '.temp', 'kv-dump'),
    in: null,
    dryRun: false,
    force: false,
    renameLegacyIndex: false,
    includeEmpty: false,
    limit: 0,
    keys: null,
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const next = () => argv[++i]
    switch (a) {
      case '--source':
        args.source = next()
        break
      case '--target':
        args.target = next()
        break
      case '--kv-namespace-id':
        args.kvNamespaceId = next()
        break
      case '--kv-dir':
        args.kvDir = next()
        break
      case '--r2-bucket':
        args.r2Bucket = next()
        break
      case '--r2-dir':
        args.r2Dir = next()
        break
      case '--r2-db':
        args.r2Db = next()
        break
      case '--out':
        args.out = path.resolve(next())
        break
      case '--in':
        args.in = path.resolve(next())
        break
      case '--dry-run':
        args.dryRun = true
        break
      case '--force':
        args.force = true
        break
      case '--rename-legacy-index':
        args.renameLegacyIndex = true
        break
      case '--include-empty':
        args.includeEmpty = true
        break
      case '--limit':
        args.limit = Number(next()) || 0
        break
      case '--keys':
        args.keys = new Set(
          next()
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        )
        break
      case '-h':
      case '--help':
        printHelp()
        process.exit(0)
        break
      default:
        if (a.startsWith('--')) {
          console.error(`Unknown option: ${a}`)
          printHelp()
          process.exit(1)
        }
    }
  }

  return args
}

function printHelp() {
  console.log(`migrate-kv-to-r2 — convert historical Workers KV notes to R2

Options:
  --source local|remote|dump     Data source (default: local)
  --target local|remote|dump     Data target (default: local)
  --kv-namespace-id <id>         KV namespace id (default: ${DEFAULT_KV_NAMESPACE_ID})
  --kv-dir <path>                Local KV namespace dir (default: .wrangler/state/v3/kv/<id>)
  --r2-bucket <name>             R2 bucket name (default: ${DEFAULT_R2_BUCKET})
  --r2-dir <path>                Local R2 root (default: .wrangler/state/v3/r2)
  --r2-db <path>                 Explicit miniflare R2 sqlite file
  --out <dir>                    Dump output dir when --target dump
  --in <dir>                     Dump input dir when --source dump
  --dry-run                      Parse and report, do not write
  --force                        Overwrite existing R2 objects
  --rename-legacy-index          Write .index as _index
  --include-empty                Also migrate empty/whitespace notes
  --limit <n>                    Migrate at most n keys
  --keys <a,b,c>                 Only migrate these keys

Sources:
  local   read .wrangler/state/v3/kv (miniflare)
  remote  wrangler kv key list/get --remote
  dump    read files produced by --target dump

Targets:
  local   write .wrangler/state/v3/r2 (miniflare R2 sqlite + blobs)
  remote  wrangler r2 object put --remote
  dump    write converted JSON objects for review / later upload
`)
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function md5Hex(buf) {
  return crypto.createHash('md5').update(buf).digest('hex')
}

function blobIdFor(bodyBuf) {
  const hash = sha256Hex(bodyBuf)
  const ts = BigInt(Date.now()).toString(16).padStart(16, '0')
  return `${hash}${ts}`
}

function normalizeMetadata(meta) {
  const out = { ...(meta || {}) }
  if (out.pw === null || out.pw === undefined || out.pw === '') delete out.pw
  if (out.share === true) delete out.share
  if (out.mode === 'plain') delete out.mode
  return out
}

/**
 * Convert a historical KV/R2 value (+ optional metadata) into pure-body R2
 * object + custom_metadata.
 *
 * New scheme:
 *   body             = pure note content
 *   custom_metadata  = { meta: "<NoteMetadata JSON>" }
 */
export function convertKvRecord({ key, value, kvMetadata }) {
  let metadata = {}
  if (kvMetadata) {
    if (typeof kvMetadata === 'string') {
      try {
        metadata = { ...metadata, ...JSON.parse(kvMetadata) }
      } catch {
        /* ignore invalid sqlite/custom metadata */
      }
    } else if (typeof kvMetadata === 'object') {
      metadata = { ...metadata, ...kvMetadata }
    }
  }

  let content = value ?? ''
  if (typeof content !== 'string') {
    content = Buffer.from(content).toString('utf8')
  }

  // Historical KV formats (migration source only — runtime no longer reads these).
  // Embedded worker-rs / TypeScript format: \0META:{json}\0\n{content}
  if (content.startsWith('\0META:')) {
    const end = content.indexOf('\0\n')
    if (end !== -1) {
      const metaStr = content.slice(6, end)
      try {
        metadata = { ...metadata, ...JSON.parse(metaStr) }
      } catch {
        /* keep external metadata if embedded meta is broken */
      }
      content = content.slice(end + 2)
    }
  } else if (content.startsWith('{')) {
    // Transitional R2 JSON envelope — extract content/metadata from body.
    try {
      const blob = JSON.parse(content)
      if (blob && typeof blob === 'object' && typeof blob.content === 'string') {
        metadata = { ...(blob.metadata || {}), ...metadata }
        content = blob.content
      }
    } catch {
      /* not an envelope — keep as pure content */
    }
  }

  metadata = normalizeMetadata(metadata)
  const outKey = key === LEGACY_INDEX ? INDEX_PATH : key
  // Pure content body; metadata flattened into custom_metadata keys.
  const body = content
  return {
    key,
    outKey,
    content,
    metadata,
    body,
    customMetadata: flattenCustomMetadata(metadata),
  }
}

function openSqlite(file) {
  return new DatabaseSync(file)
}

function listSqliteFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sqlite') && !f.endsWith('.sqlite-wal') && !f.endsWith('.sqlite-shm'))
    .map((f) => path.join(dir, f))
}

function readLocalKvNamespace({ kvRoot, kvNamespaceId, limit, keyFilter }) {
  const nsDir = path.join(kvRoot, kvNamespaceId)
  const blobsDir = path.join(nsDir, 'blobs')
  if (!fs.existsSync(nsDir)) {
    throw new Error(`Local KV namespace dir not found: ${nsDir}`)
  }

  const kvObjDir = path.join(kvRoot, 'miniflare-KVNamespaceObject')
  const sqliteFiles = listSqliteFiles(kvObjDir)
  if (!sqliteFiles.length) {
    throw new Error(`No miniflare KV sqlite files under ${kvObjDir}`)
  }

  // Pick the sqlite DB that actually indexes this namespace's blobs.
  let best = null
  for (const file of sqliteFiles) {
    let db
    try {
      db = openSqlite(file)
    } catch {
      continue
    }
    try {
      const rows = db.prepare('SELECT key, blob_id, metadata FROM _mf_entries').all()
      let hit = 0
      for (const row of rows) {
        if (fs.existsSync(path.join(blobsDir, row.blob_id))) hit++
      }
      if (!best || hit > best.hit) best = { file, rows, hit }
    } catch {
      db.close()
      continue
    }
    db.close()
  }

  if (!best || best.hit === 0) {
    // Fall back to the sqlite with the most rows; blobs may still resolve.
    let fallback = null
    for (const file of sqliteFiles) {
      let db
      try {
        db = openSqlite(file)
        const rows = db.prepare('SELECT key, blob_id, metadata FROM _mf_entries').all()
        if (!fallback || rows.length > fallback.rows.length) fallback = { file, rows, hit: 0 }
      } catch {
        /* skip */
      } finally {
        try {
          db?.close()
        } catch {
          /* ignore */
        }
      }
    }
    best = fallback
  }

  if (!best) {
    throw new Error('Could not find a miniflare KV sqlite index for this namespace')
  }

  const records = []
  for (const row of best.rows) {
    if (keyFilter && !keyFilter.has(row.key)) continue
    const blobPath = path.join(blobsDir, row.blob_id)
    if (!fs.existsSync(blobPath)) continue
    const value = fs.readFileSync(blobPath)
    records.push({
      key: row.key,
      value,
      kvMetadata: row.metadata,
    })
    if (limit > 0 && records.length >= limit) break
  }

  return { records, sqliteFile: best.file, nsDir }
}

function wranglerCmd(args, { cwd = projectRoot } = {}) {
  const wranglerJs = path.join(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
  if (!fs.existsSync(wranglerJs)) {
    throw new Error(`wrangler not found at ${wranglerJs}; run npm install first`)
  }
  // Spawn via node + wrangler.js — avoids Windows npx.cmd EINVAL in spawnSync.
  const res = spawnSync(process.execPath, [wranglerJs, ...args], {
    cwd,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    status: res.status,
    stdout: res.stdout ?? Buffer.alloc(0),
    stderr: res.stderr ?? Buffer.alloc(0),
    stdoutText: res.stdout ? res.stdout.toString('utf8') : '',
    stderrText: res.stderr ? res.stderr.toString('utf8') : '',
  }
}

function readRemoteKv({ kvNamespaceId, limit, keyFilter }) {
  const listRes = wranglerCmd([
    'kv',
    'key',
    'list',
    '--namespace-id',
    kvNamespaceId,
    '--remote',
  ])
  if (listRes.status !== 0) {
    throw new Error(`wrangler kv key list failed:\n${listRes.stderrText || listRes.stdoutText}`)
  }
  let entries = JSON.parse(listRes.stdoutText)
  if (!Array.isArray(entries)) entries = entries.keys || []
  entries = entries
    .map((k) =>
      typeof k === 'string'
        ? { name: k, metadata: null }
        : { name: k.name || k.key, metadata: k.metadata ?? null },
    )
    .filter((e) => e.name)

  const records = []
  for (const entry of entries) {
    const key = entry.name
    if (keyFilter && !keyFilter.has(key)) continue
    const getRes = wranglerCmd([
      'kv',
      'key',
      'get',
      key,
      '--namespace-id',
      kvNamespaceId,
      '--remote',
    ])
    if (getRes.status !== 0) {
      console.warn(`  ! failed to get KV key ${key}`)
      continue
    }
    records.push({
      key,
      value: Buffer.from(getRes.stdout),
      kvMetadata: entry.metadata,
    })
    if (limit > 0 && records.length >= limit) break
  }
  return { records }
}

function readDumpDir(dumpDir, { limit, keyFilter }) {
  const objectsDir = path.join(dumpDir, 'objects')
  if (!fs.existsSync(objectsDir)) {
    throw new Error(`Dump objects dir not found: ${objectsDir}`)
  }
  const records = []
  const files = fs.readdirSync(objectsDir).filter((f) => f.endsWith('.json'))
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(objectsDir, f), 'utf8'))
    const key = raw.key
    if (keyFilter && !keyFilter.has(key)) continue
    records.push({
      key,
      value: Buffer.from(raw.content ?? '', 'utf8'),
      kvMetadata: raw.metadata ?? null,
      // dump already holds converted fields when present
      preconverted: raw.body
        ? {
            key,
            outKey: raw.outKey || key,
            content: raw.content,
            metadata: raw.metadata || {},
            body: raw.body,
            customMetadata: raw.customMetadata || flattenCustomMetadata(raw.metadata || {}),
          }
        : null,
    })
    if (limit > 0 && records.length >= limit) break
  }
  return { records }
}

function discoverLocalR2({ r2Root, bucket, r2Db }) {
  if (r2Db) {
    return { sqliteFile: r2Db, blobsDir: path.join(r2Root, bucket, 'blobs') }
  }
  const blobsDir = path.join(r2Root, bucket, 'blobs')
  const objDir = path.join(r2Root, 'miniflare-R2BucketObject')
  const files = listSqliteFiles(objDir)
  if (!files.length) {
    throw new Error(`No miniflare R2 sqlite files under ${objDir}`)
  }
  if (files.length === 1) {
    return { sqliteFile: files[0], blobsDir }
  }

  // Prefer a DB that already has objects for this bucket / any notes.
  let best = null
  for (const file of files) {
    let db
    try {
      db = openSqlite(file)
      const rows = db.prepare('SELECT key, blob_id FROM _mf_objects').all()
      let hit = 0
      for (const row of rows) {
        if (fs.existsSync(path.join(blobsDir, row.blob_id))) hit++
      }
      if (!best || hit > best.hit) best = { file, hit, count: rows.length }
    } catch {
      /* skip */
    } finally {
      try {
        db?.close()
      } catch {
        /* ignore */
      }
    }
  }
  return { sqliteFile: best?.file || files[0], blobsDir }
}

function listExistingLocalR2Keys(sqliteFile) {
  if (!fs.existsSync(sqliteFile)) return new Set()
  const db = openSqlite(sqliteFile)
  try {
    const rows = db.prepare('SELECT key FROM _mf_objects').all()
    return new Set(rows.map((r) => r.key))
  } finally {
    db.close()
  }
}

function writeLocalR2Object({ sqliteFile, blobsDir, outKey, body, customMetadata }) {
  fs.mkdirSync(blobsDir, { recursive: true })
  const bodyBuf = Buffer.from(body, 'utf8')
  const blobId = blobIdFor(bodyBuf)
  fs.writeFileSync(path.join(blobsDir, blobId), bodyBuf)

  const now = Date.now()
  const etag = md5Hex(bodyBuf)
  const version = md5Hex(Buffer.from(`${outKey}:${now}:${blobId}`))
  const custom = JSON.stringify(customMetadata || {})

  const db = openSqlite(sqliteFile)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _mf_objects (
        key TEXT PRIMARY KEY,
        blob_id TEXT,
        version TEXT NOT NULL,
        size INTEGER NOT NULL,
        etag TEXT NOT NULL,
        uploaded INTEGER NOT NULL,
        checksums TEXT NOT NULL,
        http_metadata TEXT NOT NULL,
        custom_metadata TEXT NOT NULL
      )
    `)
    db.prepare(
      `INSERT INTO _mf_objects
        (key, blob_id, version, size, etag, uploaded, checksums, http_metadata, custom_metadata)
       VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         blob_id = excluded.blob_id,
         version = excluded.version,
         size = excluded.size,
         etag = excluded.etag,
         uploaded = excluded.uploaded,
         http_metadata = excluded.http_metadata,
         custom_metadata = excluded.custom_metadata`,
    ).run(
      outKey,
      blobId,
      version,
      bodyBuf.length,
      etag,
      now,
      JSON.stringify({ contentType: 'text/plain; charset=utf-8' }),
      custom,
    )
    return { sqliteFile, blobId, etag, size: bodyBuf.length }
  } finally {
    db.close()
  }
}

function writeDumpObject(outDir, converted) {
  const objectsDir = path.join(outDir, 'objects')
  fs.mkdirSync(objectsDir, { recursive: true })
  const safe = converted.outKey.replace(/[\\/:*?"<>|]/g, '_')
  const file = path.join(objectsDir, `${safe}.json`)
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        key: converted.key,
        outKey: converted.outKey,
        content: converted.content,
        metadata: converted.metadata,
        body: converted.body,
        customMetadata: converted.customMetadata,
      },
      null,
      2,
    ),
  )
  return file
}

/**
 * Write remote R2 object. Prefer MIGRATE_WORKER_URL (supports customMetadata);
 * fall back to wrangler CLI only when custom metadata is empty.
 */
async function writeRemoteR2Object({ bucket, outKey, body, customMetadata }) {
  const migrateUrl = process.env.MIGRATE_WORKER_URL
  if (migrateUrl) {
    const res = await fetch(`${migrateUrl.replace(/\/$/, '')}/put`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, key: outKey, body, customMetadata }),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`migrate worker put failed: ${res.status} ${text}`)
    return
  }
  if (customMetadata && Object.keys(customMetadata).length > 0) {
    throw new Error(
      'Remote R2 put needs customMetadata; set MIGRATE_WORKER_URL or run scripts/migrate-worker.js /flush',
    )
  }
  const tmp = path.join(os.tmpdir(), `kv2r2-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
  fs.writeFileSync(tmp, body, 'utf8')
  try {
    const res = wranglerCmd([
      'r2',
      'object',
      'put',
      `${bucket}/${outKey}`,
      '--file',
      tmp,
      '--content-type',
      'text/plain; charset=utf-8',
      '--remote',
    ])
    if (res.status !== 0) {
      throw new Error(res.stderrText || res.stdoutText || 'wrangler r2 object put failed')
    }
  } finally {
    fs.unlinkSync(tmp)
  }
}

function summarizeRecord(rec, converted) {
  const preview = (converted.content || '').replace(/\s+/g, ' ').slice(0, 40)
  return `${rec.key} -> ${converted.outKey}  meta=${JSON.stringify(converted.metadata)}  content="${preview}"`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const kvRoot = path.join(projectRoot, '.wrangler', 'state', 'v3', 'kv')
  const r2Root = path.join(projectRoot, '.wrangler', 'state', 'v3', 'r2')

  console.log('KV → R2 migration')
  console.log(`  source=${args.source}  target=${args.target}  dryRun=${args.dryRun}`)
  console.log(`  kvNamespaceId=${args.kvNamespaceId}  r2Bucket=${args.r2Bucket}`)

  let rawRecords
  if (args.source === 'local') {
    const kvDir = args.kvDir || path.join(kvRoot, args.kvNamespaceId)
    const root = path.dirname(kvDir) // .../kv
    const nsId = path.basename(kvDir)
    const info = readLocalKvNamespace({
      kvRoot: root,
      kvNamespaceId: nsId,
      limit: args.limit,
      keyFilter: args.keys,
    })
    console.log(`  read ${info.records.length} KV records from ${info.nsDir}`)
    console.log(`  index sqlite: ${info.sqliteFile}`)
    rawRecords = info.records
  } else if (args.source === 'remote') {
    const info = readRemoteKv({
      kvNamespaceId: args.kvNamespaceId,
      limit: args.limit,
      keyFilter: args.keys,
    })
    console.log(`  read ${info.records.length} remote KV records`)
    rawRecords = info.records
  } else if (args.source === 'dump') {
    const inDir = args.in || args.out
    const info = readDumpDir(inDir, { limit: args.limit, keyFilter: args.keys })
    console.log(`  read ${info.records.length} dump records from ${inDir}`)
    rawRecords = info.records
  } else {
    throw new Error(`Unknown source: ${args.source}`)
  }

  const convertedList = []
  for (const rec of rawRecords) {
    const converted =
      rec.preconverted ||
      convertKvRecord({
        key: rec.key,
        value: rec.value,
        kvMetadata: rec.kvMetadata,
      })
    if (!args.renameLegacyIndex) {
      // Keep historical key names; worker still resolves .index for home.
      converted.outKey = converted.key
    }
    const contentEmpty = !String(converted.content || '').trim()
    if (contentEmpty && !args.includeEmpty) {
      console.log(`  skip empty: ${rec.key}`)
      continue
    }
    convertedList.push({ rec, converted })
  }

  console.log(`  converted ${convertedList.length} notes`)

  let existing = new Set()
  if (args.target === 'local' && !args.dryRun) {
    const r2 = discoverLocalR2({
      r2Root,
      bucket: args.r2Bucket,
      r2Db: args.r2Db,
    })
    console.log(`  local R2 sqlite: ${r2.sqliteFile}`)
    console.log(`  local R2 blobs:  ${r2.blobsDir}`)
    existing = listExistingLocalR2Keys(r2.sqliteFile)
  }

  const stats = { migrated: 0, skippedExisting: 0, failed: 0 }
  const manifest = []

  for (const { rec, converted } of convertedList) {
    const line = summarizeRecord(rec, converted)
    const exists = existing.has(converted.outKey)
    if (exists && !args.force && args.target === 'local') {
      console.log(`  ~ skip existing: ${line}`)
      stats.skippedExisting++
      manifest.push({ ...converted, status: 'skipped-existing' })
      continue
    }

    if (args.dryRun) {
      console.log(`  · dry-run: ${line}`)
      stats.migrated++
      manifest.push({ ...converted, status: 'dry-run' })
      continue
    }

    try {
      if (args.target === 'local') {
        const r2 = discoverLocalR2({
          r2Root,
          bucket: args.r2Bucket,
          r2Db: args.r2Db,
        })
        writeLocalR2Object({
          sqliteFile: r2.sqliteFile,
          blobsDir: r2.blobsDir,
          outKey: converted.outKey,
          body: converted.body,
          customMetadata: converted.customMetadata,
        })
      } else if (args.target === 'remote') {
        await writeRemoteR2Object({
          bucket: args.r2Bucket,
          outKey: converted.outKey,
          body: converted.body,
          customMetadata: converted.customMetadata,
        })
      } else if (args.target === 'dump') {
        writeDumpObject(args.out, converted)
      } else {
        throw new Error(`Unknown target: ${args.target}`)
      }
      console.log(`  ✓ ${line}`)
      stats.migrated++
      manifest.push({ ...converted, status: 'migrated' })
    } catch (e) {
      console.error(`  ✗ ${rec.key}: ${e.message}`)
      stats.failed++
      manifest.push({ ...converted, status: `failed: ${e.message}` })
    }
  }

  if (!args.dryRun && args.target === 'dump') {
    fs.mkdirSync(args.out, { recursive: true })
    fs.writeFileSync(
      path.join(args.out, 'manifest.json'),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          source: args.source,
          kvNamespaceId: args.kvNamespaceId,
          r2Bucket: args.r2Bucket,
          stats,
          items: manifest.map((m) => ({
            key: m.key,
            outKey: m.outKey,
            metadata: m.metadata,
            contentLength: String(m.content || '').length,
            status: m.status,
          })),
        },
        null,
        2,
      ),
    )
    console.log(`  dump written to ${args.out}`)
  }

  console.log('\nDone.')
  console.log(`  migrated=${stats.migrated} skippedExisting=${stats.skippedExisting} failed=${stats.failed}`)
  if (args.dryRun) {
    console.log('  (dry-run: no writes performed)')
  }
  if (stats.failed) process.exitCode = 1
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) {
  main().catch((e) => {
    console.error(e.stack || e.message || e)
    process.exit(1)
  })
}
