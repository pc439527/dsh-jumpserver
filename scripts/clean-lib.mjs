#!/usr/bin/env node
/**
 * Remove the build output tree before tsc runs.
 *
 * tsc never deletes output for a source file that no longer exists, so a
 * removed module (e.g. the retired config-store) otherwise survives every
 * rebuild and keeps shipping inside the published package. This must run
 * BEFORE tsc, never after.
 */
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
rmSync(join(root, 'lib'), { recursive: true, force: true })
console.log('clean: removed lib/')
