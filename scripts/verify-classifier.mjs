import { classifyCommand } from '../lib/security/command-classifier.js'

const commands = [
  'systemctl --failed --no-pager',
  'redis-cli -p 6381 INFO | head -n 20',
  'hostname new-host',
  'date -s "2026-09-03 10:00:00"',
  'ip link set eth0 down',
  'ip addr',
  'journalctl --rotate',
  'journalctl -u nginx --since 30m',
  'dmesg -C',
  'dmesg --level=err,warn',
  'sysctl --system',
  'sysctl -a',
  "sed -n '1,20p' /etc/hosts",
  "sed -i 's/a/b/' /tmp/test",
  'sort -o /tmp/out /tmp/in',
  'uniq /tmp/in /tmp/out',
  'kubectl config current-context',
  'kubectl config use-context production',
  'env curl -d x=1 http://127.0.0.1/',
  'timeout 5 find /tmp -delete',
  'redis-cli -p 6381 FLUSHALL',
]
for (const command of commands) {
  const c = classifyCommand(command)
  console.log(JSON.stringify({ command, risk: c.risk, ruleId: c.ruleId, reason: c.reason }))
}
