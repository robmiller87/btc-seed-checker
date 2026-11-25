// Builds index.html: a single self-contained file (all crypto libs inlined) that works offline from file://.
import { build } from 'esbuild'
import { readFileSync, writeFileSync } from 'node:fs'

const res = await build({
  entryPoints: ['src/browser.js'],
  bundle: true, minify: true, format: 'iife', target: ['safari15', 'chrome100', 'firefox100'],
  write: false, legalComments: 'none',
})
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const html = readFileSync('src/page.html', 'utf8').replace('/*__BUNDLE__*/', () => js)
writeFileSync('index.html', html)
console.log(`index.html written (${(html.length / 1024).toFixed(0)} KB)`)
