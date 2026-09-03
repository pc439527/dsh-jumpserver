/** Redact command-line secrets before audit, UI or evidence persistence. */
const SECRET_ENV = '(?:TOKEN|PASSWORD|PASS|SECRET|API_KEY|APIKEY)'

export function redactCommandSecrets(command: string): string {
  let value = command
  // Environment assignments, including `env PASSWORD=x command`.
  value = value.replace(new RegExp(`\\b(${SECRET_ENV})=(?:"[^"]*"|'[^']*'|[^\\s]+)`, 'gi'), '$1=******')
  // Redis password options (separate or equals form).
  value = value.replace(/(\bredis-cli\b[^|;]*?\s(?:-a|--pass))(?:=|\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1 ******')
  // mysql -psecret, -p secret, --password=secret and --password secret.
  value = value.replace(/(\bmysql\b[^|;]*?\s-p)(?!\s(?:-|$))("[^"]*"|'[^']*'|\S+)/gi, '$1******')
  value = value.replace(/(\bmysql\b[^|;]*?\s(?:-p|--password))(?:=|\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1=******')
  // curl basic auth: preserve the username for audit value.
  value = value.replace(/(\bcurl\b[^|;]*?\s(?:-u|--user))(?:=|\s+)("?)([^\s"':]+):([^\s"']+)\2/gi, '$1 $2$3:******$2')
  // Authorization bearer headers in arbitrary command arguments.
  value = value.replace(/(Authorization\s*:\s*Bearer\s+)[^\s"']+/gi, '$1******')
  return value
}

export function normalizedRedactedCommand(command: string): string {
  return redactCommandSecrets(command).trim().replace(/\s+/g, ' ')
}
