// dsh-jumpserver V0.1 real-bastion smoke test (Test 1-5).
// Usage:
//   $env:JS_USER = 'your-jumpserver-username'
//   $env:JUMPSERVER_PASSWORD = 'your-password'
//   $env:JS_TARGET_1 = '203.0.113.101'   (optional)
//   $env:JS_TARGET_2 = '203.0.113.102'   (optional)
//   node scripts/smoke.mjs
// The password is read from the environment ONLY and is never printed or logged.
import { existsSync, readFileSync } from 'node:fs'
import { JumpServerSession } from '../lib/jumpserver/session.js'
import { JumpServerError } from '../lib/jumpserver/errors.js'
import { SessionState } from '../lib/jumpserver/state-machine.js'

const host = process.env.JS_HOST ?? '203.0.113.10'
const port = Number(process.env.JS_PORT ?? 2222)
const username = process.env.JS_USER
const password = process.env.JUMPSERVER_PASSWORD ?? resolveFromCredentialsYaml()

/** Minimal refs-section resolver; empty value = unconfigured. Never prints the value. */
function resolveFromCredentialsYaml() {
  try {
    const home = process.env.DSH_HOME ?? process.env.USERPROFILE + '/.dsh'
    const file = home + '/.credentials.yaml'
    if (!existsSync(file)) return ''
    const raw = readFileSync(file, 'utf8')
    const refsBlock = raw.split(/\n\s*records:|\n\s*version:/)[0]
    const match = /^\s*JUMPSERVER_PASSWORD\s*:\s*['"]([^'"]+)['"]/m.exec(refsBlock)
    return match !== null && match[1] && match[1].length > 0 ? match[1] : ''
  } catch {
    return ''
  }
}
const target1 = process.env.JS_TARGET_1 ?? '203.0.113.101'
const target2 = process.env.JS_TARGET_2 ?? '203.0.113.102'

if (!username || password.length === 0) {
  console.error('missing JS_USER / JUMPSERVER_PASSWORD; refusing to run')
  process.exit(2)
}

const steps = []
function step(name, value) {
  steps.push({ name, ...value })
  console.log('* ' + name + ' -> ' + JSON.stringify(value))
}

const session = new JumpServerSession({
  host,
  port,
  username,
  password,
  connectTimeoutMs: 15000,
  enterAssetMs: 40000,
  probeMs: 15000,
  commandMs: 30000,
  leaveMs: 15000,
})

try {
  // Test 1: connect and reach the JumpServer menu
  await session.connect()
  step('connect', { state: session.state, gateway: host + ':' + port })

  // Test 2+3: enter asset 1, probe-verify, run diagnostics
  await session.enter(target1)
  step('enter ' + target1, {
    state: session.state,
    target: session.currentTarget,
    hostname: session.currentHostname,
    user: session.currentUser,
    pwd: session.currentPwd,
  })

  const outcome = await session.exec('hostname; uptime; free -m; df -h', { timeoutMs: 30000 })
  step('exec diagnostics', {
    completed: outcome.kind === 'completed',
    executionState: outcome.executionState,
    exitCode: outcome.kind === 'completed' ? outcome.exitCode : null,
    outputTail: (outcome.output ?? '').slice(-600),
  })

  // Test 4: leave back to the menu
  await session.leave()
  step('leave', { state: session.state, target: session.currentTarget })

  // Test 5: switch to asset 2
  if (target2 && target2 !== '') {
    await session.enter(target2)
    step('enter ' + target2, {
      state: session.state,
      target: session.currentTarget,
      hostname: session.currentHostname,
    })
    await session.leave()
    step('leave', { state: session.state, target: session.currentTarget })
  }

  await session.close()
  step('close', { state: session.state })
  console.log('SMOKE_PASS')
} catch (error) {
  console.log('SMOKE_FAIL')
  if (error instanceof JumpServerError) {
    console.log('errorCode=' + error.code)
    console.log('message=' + error.message)
  } else {
    console.log(String(error))
  }
  console.log('screenTail>>>\n' + session.screenTail(500) + '\n<<<')
  try {
    await session.close()
  } catch {
    /* ignore */
  }
  process.exit(1)
}
