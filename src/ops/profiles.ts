/**
 * V0.3.0 Ops Investigation: read-only diagnostic profiles.
 *
 * Every command in every profile MUST classify as READ (the permission gate
 * applies to them exactly like any agent command, so a READ_ONLY deployment
 * must never trigger approval prompts for a triage sweep). A dedicated test
 * (ops-profiles.test.ts) asserts this for the whole table, so adding a
 * command that the classifier would block is a test failure, not a runtime
 * surprise. The 'since' placeholder keeps error-window commands bounded.
 */
export interface ProfileCommand {
  command: string
  category: 'identity' | 'cpu-mem' | 'disk' | 'process' | 'service' | 'network' | 'errors' | 'app' | 'detect'
  label?: string
}

export interface DiagnosticProfile {
  id: string
  label: string
  commands: ProfileCommand[]
}

/** Sanitized journalctl/dmesg window (default 30m). */
export function sanitizeSince(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (/^\d{1,4}[smhd]$/.test(value)) return value
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{1,2}:\d{2})?$/.test(value)) return value
  return '30m'
}

/** Linux base sweep — identity, resources, disk, processes, services, network. */
export const LINUX_BASE: DiagnosticProfile = {
  id: 'linux',
  label: 'Linux base',
  commands: [
    { command: 'hostname', category: 'identity' },
    { command: 'uname -a', category: 'identity' },
    { command: 'cat /etc/os-release', category: 'identity' },
    { command: 'date', category: 'identity' },
    { command: 'uptime', category: 'identity' },
    { command: 'who', category: 'identity' },
    { command: 'nproc', category: 'cpu-mem' },
    { command: 'lscpu', category: 'cpu-mem' },
    { command: 'free -m', category: 'cpu-mem' },
    { command: 'vmstat 1 3', category: 'cpu-mem' },
    { command: 'iostat -x 1 2 2>/dev/null | tail -n 20', category: 'cpu-mem' },
    { command: 'df -h', category: 'disk' },
    { command: 'df -i', category: 'disk' },
    { command: 'lsblk', category: 'disk' },
    { command: 'ps -eo pid,ppid,user,%cpu,%mem,cmd --sort=-%cpu | head -n 15', category: 'process' },
    { command: 'ps -eo pid,ppid,user,%cpu,%mem,cmd --sort=-%mem | head -n 15', category: 'process' },
    { command: 'ps -eo stat,cmd | awk \'BEGIN{z=0} $1 ~ /Z/ {z++} END{print "zombie_count=" z}\'', category: 'process' },
    { command: 'systemctl list-units --type=service --state=failed --no-pager | head -n 20', category: 'service' },
    { command: 'systemctl list-units --type=service --state=running --no-pager | head -n 40', category: 'service' },
    { command: 'ip addr', category: 'network' },
    { command: 'ip route', category: 'network' },
    { command: 'ss -lntup', category: 'network' },
    { command: 'ss -s', category: 'network' },
  ],
}

/** App-detection sweep: process names + units + listeners (parsed for markers). */
export const DETECT_PROFILE: { commands: ProfileCommand[] } = {
  commands: [
    { command: 'ps -eo comm', category: 'detect' },
    { command: 'systemctl list-units --type=service --no-pager | head -n 60', category: 'detect' },
    { command: 'ss -lntu', category: 'detect' },
  ],
}

/** Error-window commands shared by base and app profiles. */
export function errorCommands(since: string): ProfileCommand[] {
  return [
    { command: 'journalctl -p err --since ' + since + ' --no-pager | tail -n 100', category: 'errors', label: 'journal errors (since ' + since + ')' },
    { command: 'dmesg --level=err,warn | tail -n 50', category: 'errors' },
  ]
}

interface AppDef {
  id: string
  label: string
  markers: RegExp[]
  commands: ProfileCommand[]
}

const APP_DEFS: AppDef[] = [
  {
    id: 'nginx',
    label: 'Nginx',
    markers: [/\bnginx\b/i, /nginx\.conf/i],
    commands: [
      { command: 'nginx -V 2>&1', category: 'app' },
      { command: 'nginx -t 2>&1', category: 'app' },
      { command: 'nginx -T 2>&1 | grep -E "server_name|listen|proxy_pass|upstream" | head -n 60', category: 'app' },
      { command: 'ps -eo pid,user,%cpu,%mem,cmd | grep -E "[n]ginx" | head -n 20', category: 'app' },
      { command: 'ss -lntp | grep -E ":80\s|:443\s|nginx"', category: 'app' },
      { command: 'systemctl status nginx --no-pager | head -n 15', category: 'service' },
      { command: 'find /etc/nginx -maxdepth 3 \( -name "*.conf" -o -name "nginx.conf" \) | head -n 30', category: 'app' },
      { command: 'ls -la /etc/nginx/conf.d /etc/nginx/sites-enabled 2>/dev/null | head -n 30', category: 'app' },
      { command: 'find /etc/nginx -maxdepth 2 \( -name "*.pem" -o -name "*.crt" -o -name "*.key" \) | head -n 20', category: 'app', label: 'tls materials' },
      { command: 'curl -sI http://127.0.0.1/ | head -n 10', category: 'app' },
      { command: '%SINCE%', category: 'errors', label: 'nginx journal errors' },
    ],
  },
  {
    id: 'apache',
    label: 'Apache httpd',
    markers: [/\bhttpd\b/i, /\bapache2\b/i],
    commands: [
      { command: 'httpd -V 2>&1 | head -n 20', category: 'app' },
      { command: 'ps -eo pid,user,%cpu,%mem,cmd | grep -E "[h]ttpd|[a]pache2" | head -n 20', category: 'app' },
      { command: 'ss -lntp | grep -E ":80\s|:443\s|httpd"', category: 'app' },
      { command: 'systemctl status httpd --no-pager | head -n 15', category: 'service' },
      { command: 'systemctl status apache2 --no-pager | head -n 15', category: 'service' },
      { command: 'apachectl -S 2>&1 | head -n 40', category: 'app' },
      { command: 'tail -n 80 /var/log/httpd/error_log /var/log/apache2/error.log 2>/dev/null', category: 'errors' },
    ],
  },
  {
    id: 'java',
    label: 'Java (JVM)',
    markers: [/\bjava\b/, /\bjvm\b/i],
    commands: [
      { command: 'java -version 2>&1', category: 'app' },
      { command: 'ps -eo pid,rss,user,%cpu,%mem,cmd --sort=-rss | grep -E "[j]ava" | head -n 20', category: 'app' },
      { command: 'ls -la /usr/lib/jvm 2>/dev/null | head -n 20', category: 'app' },
      { command: 'find /opt -maxdepth 2 -type d \( -name "*java*" -o -name "*jdk*" \) 2>/dev/null | head -n 20', category: 'app' },
      { command: 'ss -lntp | grep -E "java|[0-9]{4}\s" | head -n 20', category: 'app' },
      { command: 'jcmd -l 2>/dev/null | head -n 20', category: 'app' },
    ],
  },
  {
    id: 'resin',
    label: 'Resin',
    markers: [/\bresin\b/i, /resin\.conf/i],
    commands: [
      { command: 'ps -eo pid,user,%cpu,%mem,cmd | grep -E "[r]esin" | head -n 20', category: 'app' },
      { command: 'find /usr/local/resin /opt/resin /www/resin -maxdepth 2 -name "*.conf" 2>/dev/null | head -n 20', category: 'app' },
      { command: 'systemctl status resin --no-pager | head -n 15', category: 'service' },
      { command: 'tail -n 100 /var/log/resin/*.log 2>/dev/null', category: 'errors' },
    ],
  },
  {
    id: 'tomcat',
    label: 'Tomcat',
    markers: [/\bcatalina\b/i, /\btomcat\b/i],
    commands: [
      { command: 'ps -eo pid,user,%cpu,%mem,cmd | grep -E "[c]atalina|[t]omcat" | head -n 20', category: 'app' },
      { command: 'find /opt /usr/local -maxdepth 2 -type d \( -name "apache-tomcat*" -o -name "tomcat*" \) 2>/dev/null | head -n 10', category: 'app' },
      { command: 'systemctl status tomcat --no-pager | head -n 15', category: 'service' },
      { command: 'tail -n 80 /opt/*/tomcat*/logs/catalina.out /var/log/tomcat*/catalina.out 2>/dev/null', category: 'errors' },
    ],
  },
  {
    id: 'node',
    label: 'Node.js',
    markers: [/\bnodejs\b/i, /\bnode\b/, /\bpm2\b/i],
    commands: [
      { command: 'node --version', category: 'app' },
      { command: 'ps -eo pid,user,%cpu,%mem,cmd | grep -E "[n]ode" | head -n 20', category: 'app' },
      { command: 'ss -lntp | head -n 25', category: 'app' },
      { command: 'systemctl list-units --type=service --state=running --no-pager | grep -E "node|pm2" | head -n 10', category: 'service' },
      { command: '%SINCE%', category: 'errors', label: 'node journal errors' },
    ],
  },
  {
    id: 'mysql',
    label: 'MySQL / MariaDB',
    markers: [/\bmysqld\b/i, /\bmariadb\b/i],
    commands: [
      { command: 'ps -eo pid,user,%cpu,%mem,cmd | grep -E "[m]ysqld|[m]ariadb" | head -n 15', category: 'app' },
      { command: 'ss -lntp | grep -E "3306|mysql"', category: 'app' },
      { command: 'systemctl status mysqld --no-pager | head -n 15', category: 'service' },
      { command: 'systemctl status mariadb --no-pager | head -n 15', category: 'service' },
      { command: 'journalctl -u mysqld --since %SINCE% --no-pager | tail -n 60', category: 'errors' },
    ],
  },
  {
    id: 'oracle',
    label: 'Oracle',
    markers: [/\boracle\b/i, /tnslsnr/i],
    commands: [
      { command: 'ps -eo pid,user,%cpu,%mem,cmd | grep -E "[o]racle|[t]nslsnr" | head -n 15', category: 'app' },
      { command: 'ss -lntp | grep -E "1521|oracle"', category: 'app' },
      { command: 'systemctl status oracle --no-pager | head -n 15', category: 'service' },
      { command: 'dmesg --level=err,warn | head -n 40', category: 'errors' },
    ],
  },
  {
    id: 'redis',
    label: 'Redis',
    markers: [/\bredis-server\b/i, /redis\.conf/i],
    commands: [
      { command: 'ps -eo pid,user,%cpu,%mem,cmd | grep -E "[r]edis" | head -n 15', category: 'app' },
      { command: 'ss -lntp | grep -E "6379|redis"', category: 'app' },
      { command: 'systemctl status redis --no-pager | head -n 15', category: 'service' },
      { command: 'find /etc /opt -maxdepth 3 -name "redis.conf" 2>/dev/null | head -n 10', category: 'app' },
      { command: 'journalctl -u redis --since %SINCE% --no-pager | tail -n 60', category: 'errors' },
    ],
  },
  {
    id: 'docker',
    label: 'Docker',
    markers: [/dockerd/i, /\bdocker\b/i],
    commands: [
      { command: 'docker ps -a | head -n 30', category: 'app' },
      { command: 'docker images | head -n 15', category: 'app' },
      { command: 'docker stats --no-stream 2>/dev/null | head -n 15', category: 'app' },
      { command: 'systemctl status docker --no-pager | head -n 15', category: 'service' },
      { command: 'journalctl -u docker --since %SINCE% --no-pager | tail -n 60', category: 'errors' },
    ],
  },
  {
    id: 'kubernetes',
    label: 'Kubernetes',
    markers: [/kubelet/i, /kube-apiserver/i, /\betcd\b/i],
    commands: [
      { command: 'kubectl get nodes 2>/dev/null | head -n 10', category: 'app' },
      { command: 'kubectl get pods -A 2>/dev/null | head -n 20', category: 'app' },
      { command: 'systemctl status kubelet --no-pager | head -n 15', category: 'service' },
      { command: 'journalctl -u kubelet --since %SINCE% --no-pager | tail -n 60', category: 'errors' },
      { command: 'ps -eo pid,user,%cpu,%mem,cmd | grep -E "[k]ubelet|[k]ube-apiserver|[e]tcd" | head -n 15', category: 'app' },
    ],
  },
]

export const APP_PROFILES: DiagnosticProfile[] = APP_DEFS.map((def) => ({ id: def.id, label: def.label, commands: def.commands }))

/** Collapse a profile into executable commands, resolving the since window. */
export function profileCommands(profile: DiagnosticProfile, since: string): ProfileCommand[] {
  const windowed: ProfileCommand[] = profile.commands.map((c) => {
    if (c.command === '%SINCE%') return { command: 'journalctl -u ' + profile.id + ' --since ' + since + ' --no-pager | tail -n 60', category: 'errors' as const, label: c.label }
    return { ...c, command: c.command.split('%SINCE%').join(since) }
  })
  return windowed
}

/** Base sweep + error window => the always-run command list. */
export function linuxCommands(since: string): ProfileCommand[] {
  return [...LINUX_BASE.commands, ...errorCommands(since)]
}

/** Which app profiles are present, judged from the detection sweep output. */
export function detectAppIds(detectionText: string): string[] {
  const present: string[] = []
  for (const def of APP_DEFS) {
    if (def.markers.some((marker) => marker.test(detectionText))) present.push(def.id)
  }
  return present
}

export function resolveProfile(id: string): DiagnosticProfile | undefined {
  if (id === 'linux') return LINUX_BASE
  if (id === 'apache') return APP_PROFILES.find((p) => p.id === 'apache')
  return APP_PROFILES.find((p) => p.id === id)
}

/** Every executable command across all profiles (for the READ-classification test). */
export function allProfileCommands(): string[] {
  const out: string[] = []
  const add = (list: ProfileCommand[]): void => {
    for (const c of list) {
      out.push(c.command === '%SINCE%' ? 'journalctl -u nginx --since 30m --no-pager | tail -n 60' : c.command.split('%SINCE%').join('30m'))
    }
  }
  add(LINUX_BASE.commands)
  add(errorCommands('30m'))
  add(DETECT_PROFILE.commands)
  for (const p of APP_PROFILES) add(p.commands)
  return [...new Set(out)]
}
