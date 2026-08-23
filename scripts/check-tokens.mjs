// W3 token gate: brainmap-page chrome must reference --dsw-* tokens; no bare
// color literals outside var() fallbacks and registered exemptions (§13.3).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = 'src/client'
const FILE_EXEMPT = new Set([
  'src/client/canvas-theme.ts',            // renderer data between markers (D-S3-9)
  'src/client/preview/artifact-html.ts',   // generated artifact template
  'src/client/components/MindmapToolCard.tsx', // §12 chat surface, frozen at S3
  'src/client/preview/dialog.tsx',         // §12 chat surface, frozen at S3
])
const COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsl\(/

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

function cutSpans(line) {
  // Remove color-mix(...) spans (up to two nesting levels): composites over
  // tokens are compliant by construction; their inner var()s strip below.
  let s = line
  for (let pass = 0; pass < 2; pass++) {
    let i = s.indexOf('color-mix(')
    while (i >= 0) {
      let depth = 0
      for (let j = i; j < s.length; j++) {
        if (s[j] === '(') depth++
        else if (s[j] === ')') { depth--; if (depth === 0) { s = s.slice(0, i) + ' '.repeat(j - i + 1) + s.slice(j + 1); break } }
      }
      i = s.indexOf('color-mix(', i + 1)
    }
  }
  // Remove var(--...) spans incl. one nested-paren level (fallbacks).
  s = s.replace(/var\(--[a-zA-Z0-9-]+(?:\s*,[^()]*(?:\([^()]*\)[^()]*)*)?\)/g, (m) => ' '.repeat(m.length))
  return s
}

let violations = 0
for (const file of walk(ROOT)) {
  const norm = file.replace(/\\/g, '/')
  if (FILE_EXEMPT.has(norm)) continue
  const lines = readFileSync(file, 'utf8').split(/\n/)
  lines.forEach((line, idx) => {
    if (line.includes('@token-exempt-line')) return
    const stripped = cutSpans(line)
    const m = stripped.match(COLOR)
    if (m) { console.error(norm + ':' + (idx + 1) + ' :: ' + m.join(',') + ' :: ' + line.trim().slice(0, 100)); violations++ }
  })
}
if (violations > 0) { console.error('TOKEN GATE FAILED: ' + violations + ' violation(s)'); process.exit(1) }
console.log('token gate passed')
