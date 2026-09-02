// Safely writes JUMPSERVER_PASSWORD into $DSH_HOME/.credentials.yaml (refs section).
// Usage (in YOUR shell, password never leaves your machine):
//   $env:JUMPSERVER_PASSWORD = 'your-password'
//   node scripts/set-credential.mjs
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const home = process.env.DSH_HOME ?? (process.env.USERPROFILE + '/.dsh')
const file = resolve(home, '.credentials.yaml')
const value = process.env.JUMPSERVER_PASSWORD ?? ''
if (value.length === 0) {
  console.error('JUMPSERVER_PASSWORD is empty; nothing written.')
  process.exit(2)
}

mkdirSync(home, { recursive: true })
let raw = existsSync(file) ? readFileSync(file, 'utf8') : ''
raw = raw.trimEnd() + '\n'

const lines = raw.split('\n')
let refsIndex = lines.findIndex((l) => /^refs:/.test(l))
const versionIndex = lines.findIndex((l) => /^version:/.test(l))
if (refsIndex >= 0) {
  // insert the entry right after the refs: line, replacing any previous value
  const entry = '  JUMPSERVER_PASSWORD: ' + JSON.stringify(value)
  const end = lines.findIndex((l, i) => i > refsIndex && /^\S/.test(l))
  const sliceEnd = end < 0 ? lines.length : end
  const existingIdx = lines
    .slice(refsIndex + 1, sliceEnd)
    .findIndex((l) => /^\s*JUMPSERVER_PASSWORD\s*:/.test(l))
  if (existingIdx >= 0) {
    lines[refsIndex + 1 + existingIdx] = entry
  } else {
    lines.splice(refsIndex + 1, 0, entry)
  }
} else {
  const header = versionIndex >= 0 ? versionIndex + 1 : 0
  lines.splice(header, 0, '', 'refs:', '  JUMPSERVER_PASSWORD: ' + JSON.stringify(value))
}
writeFileSync(file, lines.join('\n').trimEnd() + '\n')
console.log('JUMPSERVER_PASSWORD ref written to ' + file + ' (value never printed)')
