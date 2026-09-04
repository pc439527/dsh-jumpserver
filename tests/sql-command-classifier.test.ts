import { describe, expect, it } from 'vitest'
import { classifyCommand } from '../src/security/permission.js'

describe('mysql/mariadb semantic command classification', () => {
  const risk = (command: string) => classifyCommand(command).risk

  it('allows routine non-interactive SELECT/SHOW/DESCRIBE diagnostics', () => {
    expect(risk('mysql -e "SELECT 1"')).toBe('READ')
    expect(risk('mysql --database=test --batch --raw -e "SHOW TABLES"')).toBe('READ')
    expect(risk('mariadb -e "DESCRIBE users"')).toBe('READ')
    expect(risk('mysql --defaults-extra-file=/tmp/ro-my.cnf --database=demo --batch --raw -e "SELECT device_id,COUNT(*) FROM qlty_quality_track GROUP BY device_id"')).toBe('READ')
  })

  it('keeps ordinary data/schema changes out of READ', () => {
    expect(risk('mysql -e "UPDATE t SET a=1 WHERE id=1"')).toBe('MODIFY')
    expect(risk('mysql -e "DELETE FROM t WHERE id=1"')).toBe('MODIFY')
    expect(risk('mysql -e "CREATE TABLE t(id int)"')).toBe('MODIFY')
    expect(risk('mysql -e "SET GLOBAL max_connections=500"')).toBe('MODIFY')
  })

  it('treats destructive SQL as dangerous', () => {
    expect(risk('mysql -e "DROP TABLE t"')).toBe('DANGEROUS')
    expect(risk('mysql -e "TRUNCATE TABLE t"')).toBe('DANGEROUS')
  })

  it('takes the worst risk across multiple SQL statements', () => {
    expect(risk('mysql -e "SELECT 1; SELECT 2"')).toBe('READ')
    expect(risk('mysql -e "SELECT 1; UPDATE t SET a=1"')).toBe('MODIFY')
    expect(risk('mysql -e "SELECT 1; DROP TABLE t"')).toBe('DANGEROUS')
  })

  it('fails closed for ambiguous/side-effecting query forms', () => {
    expect(risk('mysql')).toBe('UNKNOWN')
    expect(risk('mysql -e "CALL do_something()"')).toBe('UNKNOWN')
    expect(risk('mysql -e "WITH x AS (SELECT 1) SELECT * FROM x"')).toBe('UNKNOWN')
    expect(risk('mysql -e "SELECT * FROM t FOR UPDATE"')).toBe('UNKNOWN')
    expect(risk('mysql -e "EXPLAIN ANALYZE SELECT * FROM t"')).toBe('UNKNOWN')
  })

  it('does not allow SELECT variants that write server-side files', () => {
    expect(risk('mysql -e "SELECT * FROM t INTO OUTFILE \'/tmp/t.txt\'"')).toBe('MODIFY')
    expect(risk('mysql -e "SELECT * FROM t INTO DUMPFILE \'/tmp/t.bin\'"')).toBe('MODIFY')
  })

  it('does not bypass generic shell safety for chaining or redirection', () => {
    expect(risk('mysql -e "SELECT 1" > /tmp/out')).not.toBe('READ')
    expect(risk('mysql -e "SELECT 1" | tee /tmp/out')).not.toBe('READ')
    expect(risk('mysql < /tmp/script.sql')).not.toBe('READ')
  })
})
