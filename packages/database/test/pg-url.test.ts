import { describe, expect, test } from 'bun:test'
import { createConnection } from '../src/connection'

// The pg driver parses the URL with the strict WHATWG parser and passes explicit
// fields to postgres-js, so a malformed URL fails loudly here instead of silently
// degrading to the OS user (the baffling `role "<you>" does not exist`).
describe('pg connection URL', () => {
  test('a malformed URL throws a clear, actionable error', async () => {
    await expect(
      createConnection({ driver: 'pg', url: 'not-a-valid-url' }),
    ).rejects.toThrow(/Invalid Postgres URL/)
  })

  test('the error hint mentions percent-encoding the password', async () => {
    await expect(
      createConnection({ driver: 'pg', url: '://:::' }),
    ).rejects.toThrow(/percent-encoded/)
  })
})
