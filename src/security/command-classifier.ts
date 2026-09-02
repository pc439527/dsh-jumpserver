import type { CommandRisk } from '../config/types.js'

/**
 * V0.1 command classifier.
 *
 * - DANGEROUS: irreversible / host-destructive verb phrases, checked first.
 * - MODIFY:    anything that writes state (config, process, packages, users,
 *              filesystem) including I/O redirection.
 * - LOW:       privileged reads (sudo ...): allowed in AUTO/FULL, denied in
 *              READ_ONLY (permission matrix row LOW).
 * - READ:      commands whose first token is an allowlisted reader AND that
 *              contain no dangerous syntax and no modifier anywhere.
 *
 * READ_ONLY enforcement = allowlist + dangerous-syntax scan (NOT a plain
 * keyword blacklist). Prefer false positives over false negatives.
 */

/** Dangerous syntax anywhere in a READ_ONLY command (checked on the raw text).
 *  NOTE: intentionally NO global (/g) flag — a g-flagged RegExp keeps a
 *  mutable lastIndex across .test() calls, so the same input can flip
 *  between match/no-match depending on prior calls. A stateless permission
 *  classifier must never carry regex state between commands.
 *
 *  V0.2.5 P0: '>' / '>>' were REMOVED from this pattern. Write-redirection is
 *  decided by hasFileWriteRedirection(): read-only FD redirections (2>&1,
 *  1>&2, 2>/dev/null, 2>>/dev/null, >/dev/null) stay READ, while real file
 *  writes ("> /etc/nginx/nginx.conf", ">> app.log", ">&file") are MODIFY. */
const DANGEROUS_SYNTAX_PATTERN =
  /(?:^|;|\b)\s*(?:tee\b)|\$\(|\`|\b(?:bash|sh|su|sudo)\s+-c\b|\bpython\s+-c\b|\bperl\s+-e\b|\bsystem\s*\(/i

/** Whole-command DANGEROUS phrases (host-destructive). */
const DANGEROUS_COMMANDS: RegExp[] = [
  /\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s+)*\/(?:\s|\*|$)/, // rm -rf /
  /\bmkfs(?:\.\w+)?\b/,
  /\bwipefs\b/,
  /\bdd\b/,
  /\bshutdown\b|\breboot\b|\bpoweroff\b|\bhalt\b/,
  /\biptables\s+-[FX]\b/,
  /\bDROP\s+DATABASE\b|\bTRUNCATE\s+TABLE\b/i,
  /:\s*\(\s*\)\s*\{[^}]*\|/, // fork bomb :(){ :|:& };:
  /\bkill\s+-9\s+-1\b/,
]

/** First-token reader allowlist. 'any' = any following arguments allowed for READ. */
const READ_ALLOWLIST: Record<string, ReadonlySet<string> | 'any'> = {
  hostname: 'any',
  uptime: 'any',
  date: 'any',
  whoami: 'any',
  pwd: 'any',
  uname: 'any',
  who: 'any',
  w: 'any',
  id: 'any',
  groups: 'any',
  nproc: 'any',
  lscpu: 'any',
  top: new Set(['bn1', 'b', 'n1', 'h']),
  ps: 'any',
  free: 'any',
  vmstat: 'any',
  iostat: 'any',
  mpstat: 'any',
  pidstat: 'any',
  sar: 'any',
  df: 'any',
  du: 'any',
  ls: 'any',
  stat: 'any',
  cat: 'any',
  head: 'any',
  tail: 'any',
  grep: 'any',
  awk: 'any',
  wc: 'any',
  sort: 'any',
  cut: 'any',
  uniq: 'any',
  tr: 'any',
  find: 'any', // -exec / -delete rejected by FORBIDDEN_ARGUMENT_PATTERNS
  journalctl: 'any',
  dmesg: 'any',
  ss: 'any',
  netstat: 'any',
  lsof: 'any',
  ping: 'any',
  traceroute: 'any',
  host: 'any',
  dig: 'any',
  nslookup: 'any',
  getent: 'any',
  hostnamectl: 'any',
  timedatectl: 'any',
  sysctl: 'any', // -w/--write rejected below
  lsblk: 'any',
  blkid: 'any',
  fdisk: new Set(['l']),
  last: 'any',
  lastlog: 'any',
  loginctl: 'any',
  systemctl: new Set(['status', 'show', 'list-units', 'list-timers', 'list-sockets', 'list-unit-files', 'is-active', 'is-enabled', 'cat']),
  docker: new Set(['ps', 'logs', 'inspect', 'stats', 'images', 'version']),
  kubectl: new Set(['get', 'describe', 'logs', 'version']),
  ip: new Set(['addr', 'address', 'link', 'route', 'neigh', 'rule', 'mroute', 'tunnel']),
  curl: 'any', // non-GET/HEAD, -o, -O, -T, -F, -d rejected below
  echo: 'any',
  printenv: 'any',
  // NOTE: wget is intentionally NOT allowlisted — 'wget <url>' writes a file
  // by default (wget -qO- stdout form is fine via curl). env is a WRAPPER:
  // its inner command is classified recursively (see WRAPPER_TOKENS).
  clear: 'any',
  history: 'any',
  // V0.2.5: common read-only diagnostics (version probes, path resolution,
  // package queries, container/supervisor status). Write/signal forms (nginx
  // -s, rpm -i/-U, dpkg -i, crictl run, podman run, supervisorctl start) are
  // NOT allowed — the verb set is strictly read-only.
  nginx: new Set(['v', 'V', 't', 'T']),
  httpd: new Set(['v', 'V', 't', 'T', 'S']),
  apachectl: new Set(['S', 't', 'v', 'V']),
  jcmd: new Set(['l']),
  java: new Set(['version']),
  node: new Set(['v', 'version']),
  python3: new Set(['V', 'version']),
  python: new Set(['V', 'version']),
  openssl: new Set(['version']),
  which: 'any',
  type: 'any',
  readlink: 'any',
  realpath: 'any',
  rpm: new Set(['q', 'qa', 'qi', 'ql', 'qf', 'V']),
  dpkg: new Set(['l', 'L', 's', 'S', 'V']),
  'dpkg-query': 'any',
  crictl: new Set(['ps', 'images', 'stats', 'info', 'version', 'logs', 'inspect']),
  podman: new Set(['ps', 'images', 'stats', 'info', 'version', 'logs', 'inspect', 'top']),
  supervisorctl: new Set(['status']),
  'systemd-analyze': 'any',
  lsmod: 'any',
  ethtool: 'any',
}

/** Sub-argument patterns that FORBID a read. */
const FORBIDDEN_ARGUMENT_PATTERNS: Array<{ match: RegExp; reason: string }> = [
  { match: /\bfind\b[^&|;]*\s-(?:exec|delete|ok)\b/, reason: 'find -exec/-delete mutates' },
  { match: /\bsysctl\b[^&|;]*\s-(?:w|write)\b/, reason: 'sysctl -w mutates' },
  { match: /\bcurl\b[^&|;]*\s-(?:X|request)\b/, reason: 'curl needs an explicit method check' },
  { match: /\bcurl\b[^&|;]*\s(?:-X|--request)\s+\S+(?<!GET|HEAD)\b/i, reason: 'curl non-GET/HEAD mutates' },
  { match: /\bcurl\b[^&|;]*\s-{1,2}(?:o|output|O|remote-name|T|upload-file|F|form|d|data|data-binary)\b/, reason: 'curl writes files / posts data / uploads' },
  { match: /\bawk\b[^&|;]*\bsystem\s*\(/, reason: 'awk system() may run anything' },
  { match: /\b(?:bash|sh)\s+-c\b/, reason: 'shell -c wrapping is not verifiable' },
]

/** Modifier verbs anywhere. systemctl/docker/kubectl have their own verb-scoped patterns; package managers are not allowlisted readers so first-token checks already block them. */
/** V0.2.7 P0: command wrappers whose INNER command is classified recursively.
 *  'env python3 -c "<write>"' must not sneak through as an env read. */
const WRAPPER_TOKENS = new Set(['env', 'timeout', 'nice'])

function isWrapperToken(token: string | undefined): boolean {
  return token !== undefined && WRAPPER_TOKENS.has(token)
}

/**
 * Strip a wrapper invocation down to its inner command: consume the wrapper
 * token, its option flags (-i, -n, -s, --adjustment ...), env assignments
 * (FOO=bar) and timeout durations (plain numbers), stopping at the first
 * real command token.
 */
function stripWrapper(segment: string, wrapper: string): string {
  const toks = segment.split(/\s+/u).filter((t) => t.length > 0)
  let i = 1 // skip the wrapper itself
  for (; i < toks.length; i++) {
    const t = toks[i]!
    if (t === '--') {
      i += 1
      break
    }
    if (/^--?[a-zA-Z][a-zA-Z-]*$/.test(t)) {
      // option flag; when it takes an inline value (nice -n 10, env -u VAR,
      // timeout -s KILL) skip the pair, unless the "value" is another flag
      // or an env assignment (env -i FOO=1 hostname).
      const next = toks[i + 1]
      if (next !== undefined && !/^--?[a-zA-Z]/.test(next) && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(next)) i += 1
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue // env assignment
    if (wrapper === 'timeout' && /^\d+(\.\d+)?$/.test(t)) continue // duration
    break
  }
  void wrapper
  return toks.slice(i).join(' ')
}

/** Recursive allowlist classification of one segment (wrapper -> inner -> reader). */
export function readClassifySegment(segment: string): 'READ' | 'MODIFY' | 'DANGEROUS' {
  const token = firstToken(segment)
  if (isWrapperToken(token)) {
    const inner = stripWrapper(segment, token!)
    if (inner.trim().length === 0) return 'READ' // bare 'env' just lists environment
    return readClassifySegment(inner)
  }
  if (token === 'sudo') return readClassifySegment(segment.replace(/^sudo\b\s*/u, ''))
  return readClassify(segment)
}

const MODIFY_VERBS =
  /\b(?:rm|mv|cp|touch|mkdir|rmdir|install|chmod|chown|chgrp|ln|kill|pkill|killall|tee|truncate|mount|umount|useradd|userdel|usermod|passwd|groupadd|groupdel|crontab|at|systemd-run|tar|unzip|gunzip|chroot|git|svn|make|cmake|npm|yarn|pnpm|pip|pip3|apt|apt-get|yum|dnf|zypper|pacman)\b/i

const SYSTEMCTL_MODIFY = /\bsystemctl\b[^&|;]*\s(?:start|stop|restart|reload|enable|disable|mask|unmask|daemon-reload|kill|reset-failed)\b/
const SERVICE_MODIFY = /\bservice\b[^&|;]*\s(?:start|stop|restart|reload|force-reload)\b/
const DOCKER_MODIFY = /\bdocker\b[^&|;]*\s(?:stop|start|restart|kill|rm|exec|run|build|push|pull|tag|rmi|commit|save|load|network|volume|swarm|update|rename)\b/
const KUBECTL_MODIFY = /\bkubectl\b[^&|;]*\s(?:apply|delete|edit|scale|patch|create|rollout|exec|port-forward|drain|cordon|uncordon)\b/
const PKG_MODIFY = /\b(?:apt|apt-get|yum|dnf|zypper|pacman)\b[^&|;]*\s(?:install|remove|purge|update|upgrade|dist-upgrade|autoremove)\b/
const SED_INPLACE = /\bsed\b[^&|;]*\s-i\b/
/** Write-redirection operator with an optional FD prefix: ">", "2>", ">>", "2>>". */
const REDIRECT_OP = /(?:^|\b)(\d{1,2})?\s*[>»]{1,2}\s*([^;|>\s»]*)/g
const TAR_EXTRACT = /\btar\b[^&|;]*\s-x(?:[a-zA-Z]*)\b/

/**
 * V0.2.5 P0: read-only FD redirections must NOT be classified as file writes.
 * Allowed (return null): 2>&1, 1>&2, 2>/dev/null, 2>>/dev/null, >/dev/null —
 * FD duplication and explicit discard cannot modify server state. Still MODIFY
 * (return the target): "> file", ">> app.log", ">&file", "command >".
 * Quoted regions are masked first, so 'echo "> x"' stays data, not redirection.
 */
export function hasFileWriteRedirection(command: string): string | null {
  const masked = maskQuoted(command)
  REDIRECT_OP.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = REDIRECT_OP.exec(masked)) !== null) {
    const target = (m[2] ?? '').trim()
    if (target.length === 0) return '' // "command >" has no target — refuse
    if (/^&\d+$/.test(target)) continue // FD duplication: 2>&1 / 1>&2
    if (target === '/dev/null') continue // explicit discard
    return target // a real file write
  }
  return null
}
const SU_EXEC = /\b(?:su|sudo)\s+(?:-c|--command)\b/
// V0.2.7 P0: 'any'-allowlisted *ctl tools were writable. Read forms (status/
// show/list) stay fine; set-/transient/pretty/ntp forms are MODIFY.
const HOSTNAMECTL_MODIFY = /\bhostnamectl\b[^&|;]*\s(?:set-|transient\b|pretty\b)/
const TIMEDATECTL_MODIFY = /\btimedatectl\b[^&|;]*\s(?:set-|ntp\b)/
const LOGINCTL_MODIFY = /\bloginctl\b[^&|;]*\s(?:terminate-|kill-|lock-|unlock-|set-|enable-linger|disable-linger)/
// ethtool: bare ifname / info flags are READ; link/feature/queue/wake/... tuning is MODIFY.
const ETHTOOL_MODIFY = /\bethtool\b[^&|;]*\s-(?:s|K|G|A|C|N|W|L|S|coalesce|features|pause|ring|channels|offload|eee|fec)\b/

/** Split on ; && || | at quote/escape boundaries (quoted pipes like grep -E 'a|b' stay intact). */
export function splitSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let i = 0
  while (i < command.length) {
    const ch = command[i]!
    if (quote !== null) {
      current += ch
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      i++
      continue
    }
    if (ch === '\\' && i + 1 < command.length) {
      current += ch + command[i + 1]!
      i += 2
      continue
    }
    if (ch === ';' || ch === '&' || ch === '|') {
      // V0.2.5: '&' directly AFTER '>' is FD duplication (2>&1, >&2, >&file),
      // NOT a command separator — it must stay inside the segment so a
      // 'tail ... 2>&1' pipeline keeps parsing as one reader command.
      if (ch === '&' && i > 0 && command[i - 1] === '>') {
        current += ch
        i++
        continue
      }
      // Skip the whole run of separators (so a trailing ';' cannot stall the loop).
      while (i < command.length && (command[i] === ';' || command[i] === '&' || command[i] === '|')) i++
      if (current.trim().length > 0) segments.push(current.trim())
      current = ''
      continue
    }
    current += ch
    i++
  }
  if (current.trim().length > 0) segments.push(current.trim())
  return segments
}

/** Mask quoted regions (and escaped chars) so dangerous-syntax scans ignore quoted content. */
function maskQuoted(command: string): string {
  let out = ''
  let quote: "'" | '"' | null = null
  let i = 0
  while (i < command.length) {
    const ch = command[i]!
    if (quote !== null) {
      out += ch === quote ? quote : 'x'
      if (ch === quote) quote = null
      i++
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      out += ch
      i++
      continue
    }
    if (ch === '\\' && i + 1 < command.length) {
      out += ' '
      i += 2
      continue
    }
    out += ch
    i++
  }
  return out
}

/** First significant token after stripping a leading env assignment. */
function firstToken(segment: string): string | undefined {
  const toks = segment.split(/\s+/u).filter((t) => t.length > 0)
  for (const t of toks) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) continue // env=VAR prefix
    return t
  }
  return undefined
}

export interface Classification {
  risk: CommandRisk
  reason?: string
}

export function classifyCommand(command: string): Classification {
  const trimmed = command.trim()
  if (trimmed.length === 0) return { risk: 'MODIFY', reason: 'empty command' }

  // 1) Whole-command dangerous phrases first (independent of segmentation).
  for (const pattern of DANGEROUS_COMMANDS) {
    if (pattern.test(trimmed)) return { risk: 'DANGEROUS', reason: pattern.source }
  }

  // 2) Raw dangerous syntax (quoted content masked out): a reader may not redirect or wrap shells.
  if (DANGEROUS_SYNTAX_PATTERN.test(maskQuoted(trimmed))) {
    return { risk: 'MODIFY', reason: 'dangerous shell syntax detected' }
  }

  const segments = splitSegments(trimmed)
  if (segments.length === 0) return { risk: 'MODIFY', reason: 'unparseable command' }

  // 3) Modifier verbs anywhere in any segment.
  const whole = ' ' + trimmed + ' '
  if (
    SYSTEMCTL_MODIFY.test(whole) ||
    SERVICE_MODIFY.test(whole) ||
    DOCKER_MODIFY.test(whole) ||
    KUBECTL_MODIFY.test(whole) ||
    PKG_MODIFY.test(whole) ||
    SED_INPLACE.test(whole) ||
    TAR_EXTRACT.test(whole) ||
    SU_EXEC.test(whole) ||
    HOSTNAMECTL_MODIFY.test(whole) ||
    TIMEDATECTL_MODIFY.test(whole) ||
    LOGINCTL_MODIFY.test(whole) ||
    ETHTOOL_MODIFY.test(whole) ||
    hasFileWriteRedirection(whole) !== null ||
    MODIFY_VERBS.test(whole)
  ) {
    return { risk: 'MODIFY', reason: 'mutating verb detected' }
  }

  // 4) Every segment must be a known reader (or a privileged READ via sudo /
  //    a wrapper whose inner command classifies READ — V0.2.7 P0).
  for (const segment of segments) {
    const token = firstToken(segment)
    if (token === 'sudo') {
      const rest = segment.replace(/^sudo\b\s*/u, '')
      const inner = readClassifySegment(rest)
      if (inner === 'READ') return { risk: 'LOW', reason: 'privileged read (sudo)' }
      return { risk: inner === 'DANGEROUS' ? 'DANGEROUS' : 'MODIFY', reason: 'sudo modifies state' }
    }
    if (isWrapperToken(token)) {
      const inner = stripWrapper(segment, token!)
      if (inner.trim().length === 0) continue // bare 'env' only lists the environment
      if (readClassifySegment(inner) !== 'READ') {
        return { risk: 'MODIFY', reason: 'wrapper around a non-read command: ' + (token ?? '?') }
      }
      continue
    }
    const spec = token !== undefined ? READ_ALLOWLIST[token] : undefined
    if (spec === undefined) {
      return { risk: 'MODIFY', reason: 'command not allowlisted: ' + (token ?? '?') }
    }
    if (spec !== 'any') {
      const opts = segment.split(/\s+/u).slice(1).map((o) => o.replace(/^-+/u, ''))
      const ok = opts.some((o) => spec.has(o))
      if (!ok) return { risk: 'MODIFY', reason: 'verb not allowed for ' + token }
    }
    for (const { match: m, reason } of FORBIDDEN_ARGUMENT_PATTERNS) {
      if (m.test(segment)) return { risk: 'MODIFY', reason }
    }
  }

  return { risk: 'READ' }
}

/** Allowlist-only classification of one segment (no sudo handling, no whole-command scans). */
function readClassify(segment: string): 'READ' | 'MODIFY' | 'DANGEROUS' {
  const token = firstToken(segment)
  const spec = token !== undefined ? READ_ALLOWLIST[token] : undefined
  if (spec === undefined) return 'MODIFY'
  if (spec !== 'any') {
    const ok = segment.split(/\s+/u).slice(1).some((o) => spec.has(o.replace(/^-+/u, '')))
    if (!ok) return 'MODIFY'
  }
  return 'READ'
}

/** Strict READ_ONLY gate: only READ passes; LOW/MODIFY/DANGEROUS are blocked. */
export function isReadOnlyAllowed(command: string): { allowed: boolean; reason?: string } {
  const { risk, reason } = classifyCommand(command)
  if (risk === 'READ') return { allowed: true }
  return { allowed: false, reason: reason ?? 'not a read-only command' }
}
