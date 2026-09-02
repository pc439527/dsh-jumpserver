#!/usr/bin/env node
/**
 * Build the browser half into lib/client.js (the shape dsh-client-modules
 * serves as /plugins/dsh-jumpserver/client.js): an esbuild CJS bundle of
 * src/client/impl.ts (react external — resolved by the loader's require),
 * spliced INSIDE a window.__ModuleLoader__.load factory so the factory's
 * require parameter reaches every import at materialization time.
 *
 * Usage: node scripts/build-client.mjs   (writes lib/client.js)
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const intermediate = join(root, 'lib', '_client-impl.cjs')
const out = join(root, 'lib', 'client.js')

mkdirSync(join(root, 'lib'), { recursive: true })

// V0.2.6 P0 version handshake: inject the client identity into the bundle.
// The meta file is written by scripts/build-version.mjs (run first, e.g.
// "build:client": node scripts/build-version.mjs && node scripts/build-client.mjs).
let clientMeta = { version: 'dev', hostBuild: 'dev' }
try {
  clientMeta = JSON.parse(readFileSync(join(root, 'lib', 'build-meta.json'), 'utf8'))
} catch {
  /* pre-build: keep 'dev' identity */
}

await build({
  entryPoints: [join(root, 'src', 'client', 'impl.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  outfile: intermediate,
  external: ['react'],
  logLevel: 'error',
  define: {
    __DSHJS_CLIENT_VERSION__: JSON.stringify(String(clientMeta.version ?? 'dev')),
    __DSHJS_CLIENT_BUILD__: JSON.stringify(String(clientMeta.hostBuild ?? 'dev')),
  },
})

const impl = readFileSync(intermediate, 'utf8')
const header = 'window.__ModuleLoader__.load({\n\tid: "dsh-jumpserver",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n'
const footer = '\n\t\treturn module.exports;\n\t}\n});\n'

writeFileSync(out, header + impl + footer)
// remove the intermediate impl artifact so the published lib stays clean
try {
  await import('node:fs').then((m) => m.unlinkSync(intermediate))
} catch {
  /* already absent */
}
console.log('client bundle written to', out, '(' + (header.length + impl.length + footer.length) + ' bytes)')

