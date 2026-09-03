import { describe, expect, it } from 'vitest'
import { normalizedRedactedCommand, redactCommandSecrets } from '../src/security/command-redaction.js'

describe('audit command secret redaction', () => {
  it.each([
    ['redis-cli -a secret INFO', 'redis-cli -a ****** INFO'],
    ['redis-cli --pass secret INFO', 'redis-cli --pass ****** INFO'],
    ['mysql -uroot -psecret -e "show processlist"', 'mysql -uroot -p****** -e "show processlist"'],
    ['mysql --password=secret -e status', 'mysql --password=****** -e status'],
    ['curl -u user:password https://example.test', 'curl -u user:****** https://example.test'],
    ['curl --user user:password https://example.test', 'curl --user user:****** https://example.test'],
    ['curl -H "Authorization: Bearer abc.def" https://example.test', 'curl -H "Authorization: Bearer ******" https://example.test'],
    ['env PASSWORD=secret TOKEN=abc command --status', 'env PASSWORD=****** TOKEN=****** command --status'],
    ['API_KEY=abc apikey=def PASS=x SECRET=y command', 'API_KEY=****** apikey=****** PASS=****** SECRET=****** command'],
  ])('redacts %s', (raw, expected) => {
    const actual = redactCommandSecrets(raw)
    expect(actual).toBe(expected)
    expect(actual).not.toContain('secret')
  })

  it('retains useful non-secret audit context and normalizes whitespace', () => {
    expect(normalizedRedactedCommand('  redis-cli   -p 6381  -a secret INFO ')).toBe('redis-cli -p 6381 -a ****** INFO')
  })
})
