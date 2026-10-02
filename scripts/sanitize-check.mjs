#!/usr/bin/env node
/**
 * check:sanitize — 脱敏门禁。
 *
 * 扫描全部 git 跟踪文件，禁止以下内容进入仓库（本插件要对外公开，仓库一旦
 * 公开历史与分支对所有人可见）。命中即以非 0 退出并逐条报告 file:line。
 *
 * 设计取舍：**宁可漏报，不误报**。规则写保守，任何可能让当前仓库自身失败的
 * 模糊匹配一律不做——门禁必须能在 CI 里长期绿灯，否则会被无视。
 *
 * 允许的"看起来像敏感值"的内容（刻意保留）：
 *   - RFC 5737 文档段 203.0.113.x / 192.0.2.x / 198.51.100.x
 *   - RFC 1918 私网 192.168.x / 10.x / 172.16-31.x
 *   - RFC 3927 / RFC 5737 / 链路本地 / 组播 127.x 169.254.x 224.x
 *   - 公网 DNS 8.8.8.8 / 8.8.4.4
 *   - 保留 TLD 邮箱 example.test
 *   - 占位主机名 dsh.internal（src/client/api.ts 的 origin 兜底值）
 *
 * 注意：本文件自身含各规则的字面量，故排除在扫描之外。
 * 实现注意：不要用 `tr` + `[:print:]` 判断二进制——macOS 上对 UTF-8 中文的
 * tr 按字节处理会误判（本仓库大量中文注释，会误报上百个文件）。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const SELF = 'scripts/sanitize-check.mjs'

/** 允许的 IPv4 段（文档保留段 + 私网 + 环回 + 链路本地 + 组播 + 公网 DNS）。 */
const ALLOWED_IPV4 =
  /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|198\.18\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.|224\.|0\.0\.0\.0$|255\.255\.255\.255$|8\.8\.(?:8\.8|4\.4)$)/

/** 占位主机名白名单。 */
const PLACEHOLDER_HOSTS = new Set(['dsh.internal'])

const RULES = [
  {
    id: 'ipv4',
    title: '非文档保留段的 IPv4（疑似真实内网地址）',
    re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    isViolation(match) {
      if (match.split('.').some((o) => Number(o) > 255)) return false
      return !ALLOWED_IPV4.test(match)
    },
  },
  {
    id: 'email',
    title: '真实邮箱地址（保留 TLD 除外）',
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/g,
    isViolation(match) {
      // 保留 TLD（RFC 6761）：example.test
      if (/\.(?:test|example|invalid|localhost)$/i.test(match)) return false
      const domain = match.slice(match.indexOf('@') + 1)
      // user@10.0.0.1 是 SSH 目标写法，不是邮箱
      if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(domain)) return false
      // 顶级域必须是 2 个以上字母：排除 dsh-jumpserver@0.4.0 这类包名/版本写法
      const tld = domain.slice(domain.lastIndexOf('.') + 1)
      return /^[A-Za-z]{2,}$/.test(tld)
    },
  },
  {
    id: 'domain',
    title: '企业内部域名后缀',
    re: /\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.(?:corp|intranet|lan)\b/gi,
    isViolation: (match) => !PLACEHOLDER_HOSTS.has(match.toLowerCase()),
  },
  {
    id: 'secret',
    title: '疑似凭据 / 私钥 / 访问令牌',
    re: /-----BEGIN[A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    isViolation: () => true,
  },
  {
    // 凭据形态的 sk- 前缀串（OpenAI/Anthropic 风格）。即使只是测试桩，公开后
    // 也会被自动密钥扫描器当成真密钥误报。\b 前置是必需的：否则 "risk-judge"
    // 这类普通词里的 "sk-" 会被误判。
    id: 'sk-token',
    title: '凭据形态的 sk- 前缀串',
    re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}/g,
    isViolation: () => true,
  },
  {
    id: 'path',
    title: '本机绝对路径',
    re: /\/Users\/[A-Za-z0-9._-]+|\/home\/[A-Za-z0-9._-]+\/|C:\\+Users\\/g,
    isViolation: () => true,
  },
]

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean)
}

const findings = []
let scanned = 0

for (const file of trackedFiles()) {
  if (file === SELF) continue
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue // 二进制或不可读文件跳过
  }
  scanned++

  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      let m
      while ((m = rule.re.exec(line)) !== null) {
        if (m[0].length === 0) { rule.re.lastIndex++; continue }
        if (rule.isViolation(m[0])) {
          findings.push({ file, line: i + 1, rule, match: m[0].slice(0, 60) })
        }
      }
    }
  }
}

console.log('check:sanitize — scanned ' + scanned + ' tracked files, ' + RULES.length + ' rules')

if (findings.length === 0) {
  console.log('check:sanitize — PASS (no credentials, real internal addresses, corporate domains or local paths)')
  process.exit(0)
}

console.error('')
console.error('check:sanitize — FAIL: ' + findings.length + ' finding(s)')
console.error('')
for (const f of findings) {
  console.error('  ' + f.file + ':' + f.line + '  [' + f.rule.id + '] ' + f.rule.title)
  console.error('      ' + f.match.replace(/	/g, ' '))
}
console.error('')
console.error('如为文档保留段/占位符，请加入 RULES 的白名单而不是删除检查。')
process.exit(1)
