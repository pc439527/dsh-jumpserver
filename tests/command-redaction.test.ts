import { describe, expect, it } from 'vitest'
import { normalizedRedactedCommand, redactCommandSecrets } from '../src/security/command-redaction.js'

describe('audit command secret redaction', () => {
  it.each([
    ['redis-cli -a secret INFO', 'redis-cli -a ****** INFO'],
    ['redis-cli --pass secret INFO', 'redis-cli --pass ****** INFO'],
    ['mysql -uroot -psecret -e "show processlist"', 'mysql -uroot -p****** -e "show processlist"'],
    ['mysql --password=secret -e status', 'mysql --password=****** -e status'],
    ['mariadb -uroot -psecret -e "SELECT 1"', 'mariadb -uroot -p****** -e "SELECT 1"'],
    ['curl -u user:password https://example.test', 'curl -u user:****** https://example.test'],
    ['curl --user user:password https://example.test', 'curl --user user:****** https://example.test'],
    ['curl -H "Authorization: Bearer abc.def" https://example.test', 'curl -H "Authorization: Bearer ******" https://example.test'],
    ['env PASSWORD=secret TOKEN=abc command --status', 'env PASSWORD=****** TOKEN=****** command --status'],
    ['API_KEY=abc apikey=def PASS=x SECRET=y command', 'API_KEY=****** apikey=****** PASS=****** SECRET=****** command'],
    ['sshpass -p secret ssh user@example.test', 'sshpass -p ****** ssh user@example.test'],
    ['docker login -u demo -p secret registry.example.test', 'docker login -u demo -p=****** registry.example.test'],
    ['kubectl --token secret get pods', 'kubectl --token=****** get pods'],
    ['java -Ddb.password=secret -jar app.jar', 'java -Ddb.password=****** -jar app.jar'],
    ['mysql://demo:secret@example.test/db', 'mysql://demo:******@example.test/db'],
  ])('redacts %s', (raw, expected) => {
    const actual = redactCommandSecrets(raw)
    expect(actual).toBe(expected)
  })

  it('never leaks representative secret values', () => {
    const actual = redactCommandSecrets('env PASSWORD=hunter2 curl -H "Authorization: Basic dXNlcjpwYXNz" https://example.test')
    expect(actual).not.toContain('hunter2')
    expect(actual).not.toContain('dXNlcjpwYXNz')
  })

  it('retains useful non-secret audit context and normalizes whitespace', () => {
    expect(normalizedRedactedCommand('  redis-cli   -p 6381  -a secret INFO ')).toBe('redis-cli -p 6381 -a ****** INFO')
  })
})
