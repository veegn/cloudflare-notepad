import { build } from 'esbuild'
import { rm } from 'node:fs/promises'

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
  target: 'es2022',
  sourcemap: isProd ? false : 'external',
  minify: isProd,
  legalComments: 'none',
  logLevel: 'info',
})
