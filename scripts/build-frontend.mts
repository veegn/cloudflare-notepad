import { build } from 'esbuild'
import { copyFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const mode = process.argv[2] === 'dev' ? 'dev' : 'prod'
const isProd = mode === 'prod'

if (isProd) {
  await rm('static/js/app.js.map', { force: true })
}

await build({
  entryPoints: ['frontend/app.ts'],
  outfile: 'static/js/app.js',
  bundle: true,
  format: 'esm',
  target: ['chrome80', 'edge80', 'firefox78', 'ios14.5', 'safari14.1'],
  sourcemap: isProd ? false : 'external',
  minify: isProd,
  legalComments: 'none',
  logLevel: 'info',
})

await copyFile(require.resolve('mermaid/dist/mermaid.min.js'), 'static/js/mermaid.min.js')
