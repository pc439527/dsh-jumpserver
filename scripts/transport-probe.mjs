import { SshPtyWire } from '../lib/jumpserver/client.js'
import { JumpServerError } from '../lib/jumpserver/errors.js'

const host = process.env.JS_HOST ?? '203.0.113.10'
const port = Number(process.env.JS_PORT ?? 2222)
console.log('probing transport:', host + ':' + port)
const t0 = Date.now()
try {
  const wire = await SshPtyWire.connect({
    host,
    port,
    username: '__dsh_probe_INVALID__',
    password: 'invalid-probe-password',
    connectTimeoutMs: 10000,
  })
  console.log('UNEXPECTED_CONNECT (transport accepted invalid creds?)')
  wire.close()
} catch (e) {
  console.log('elapsedMs=' + (Date.now() - t0))
  if (e instanceof JumpServerError) {
    console.log('code=' + e.code)
    console.log('detail=' + (e.detail ?? ''))
  } else {
    console.log('otherError=' + String(e))
  }
}
