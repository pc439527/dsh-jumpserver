import { describe, expect, it } from 'vitest'
import { applyProbe, emptyInventory } from '../src/jumpserver/host-parse.js'

/**
 * Every basic-profile probe, fed the shell echo exactly as a PTY delivers it.
 *
 * The echo bug that made inspect report hostname="hostname" and cores=null
 * stayed invisible because no test ever fed a probe its own echoed command.
 * Fixtures are real Ubuntu 22.04 output captured from the target host.
 */
const echo = (command: string, body: string) => command + '\r\n\r' + body + '\r\n'

function run(inv: ReturnType<typeof emptyInventory>, id: string, command: string, body: string) {
  applyProbe(inv, id, echo(command, body), 0, command)
}

const FREE = [
  '               total        used        free      shared  buff/cache   available',
'Mem:           15782        3020        1486          70        11276        12576',
'Swap:           4096         131        3965',
].join('\n')

const DF = [
  'Filesystem      Size  Used Avail Use% Mounted on',
  '/dev/mapper/ubuntu--vg-ubuntu--lv  786G   98G  651G  14% /',
].join('\n')

const IP = [
  '1: lo    inet 127.0.0.1/8 scope host lo',
  '2: ens160 inet 192.168.30.53/24 brd 192.168.30.255 scope global dynamic ens160',
].join('\n')

const OSR = [
  'PRETTY_NAME="Ubuntu 22.04.5 LTS"',
  'NAME="Ubuntu"',
  'VERSION_ID="22.04"',
  'ID=ubuntu',
].join('\n')

function basicProfile() {
  const inv = emptyInventory('192.168.30.53', [])
  run(inv, 'hostname', 'hostname', 'ubtsvr')
  run(inv, 'kernel', 'uname -r', '5.15.0-131-generic')
  run(inv, 'nproc', 'nproc', '4')
  run(inv, 'memory', 'free -m', FREE)
  run(inv, 'disk', 'df -h', DF)
  run(inv, 'addr', 'ip -o addr', IP)
  run(inv, 'route', 'ip route', 'default via 192.168.30.1 dev ens160 proto dhcp metric 100')
  run(inv, 'os-release', 'cat /etc/os-release', OSR)
  return inv
}

describe('basic profile survives the shell echo', () => {
  it('reports real identity, not the command text', () => {
    const inv = basicProfile()
    expect(inv.hostname).toBe('ubtsvr')
    expect(inv.kernel).toBe('5.15.0-131-generic')
    expect(inv.cores).toBe(4)
  })

  it('reports memory, disks, addresses, route and os', () => {
    const inv = basicProfile()
    expect(inv.memory.totalMb).toBeGreaterThan(1000)
    expect(inv.disks.length).toBeGreaterThan(0)
    expect(inv.interfaces.some((i) => i.addrs.includes('192.168.30.53'))).toBe(true)
    expect(inv.defaultRoute).toContain('192.168.30.1')
    expect(inv.os.name).toBe('Ubuntu')
  })

  it('no field VALUE anywhere holds the command text', () => {
    // Values only: the inventory legitimately HAS a field named hostname, so a
    // whole-document scan would always match that key and prove nothing.
    const values = Object.entries(basicProfile())
      .filter(([key]) => key !== 'roles' && key !== 'warnings')
      .map(([, value]) => JSON.stringify(value))
      .join(' ')
    const commands = ['uname -r', 'nproc', 'free -m', 'df -h', 'ip -o addr', 'ip route', 'cat /etc/os-release', '/proc/loadavg']
    for (const command of commands) {
      expect(values).not.toContain(command)
    }
  })
})

