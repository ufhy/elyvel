import { beforeEach, describe, expect, test } from 'bun:test'
import { createConnection, setConnection } from '../src/connection'
import { setEncryptionKey } from '../src/crypto'
import { Model } from '../src/model'
import { SchemaBuilder } from '../src/schema'

setEncryptionKey('test-secret-key')

class Secret extends Model {
  static override table = 'secrets'
  static override timestamps = false
  static override casts = { payload: 'encrypted' } as const
  declare id: number
  declare payload: any
}

const dialects = [
  { name: 'sqlite', connect: () => createConnection({ driver: 'sqlite', database: ':memory:' }) },
  { name: 'pglite', connect: () => createConnection({ driver: 'pglite' }) },
] as const

for (const d of dialects) {
  describe(`encrypted cast (${d.name})`, () => {
    beforeEach(async () => {
      const conn = await d.connect()
      setConnection(conn)
      await new SchemaBuilder(conn).create('secrets', (t) => {
        t.id()
        t.text('payload')
      })
    })

    test('stores ciphertext, returns plaintext', async () => {
      await Secret.create({ payload: { ssn: '123-45-6789', pin: 4242 } })

      // Raw DB value is ciphertext (base64 iv:tag:ct), not the plaintext.
      const rows = await useRaw()
      const stored = String(rows[0]?.payload)
      expect(stored).not.toContain('123-45-6789')
      expect(stored.split(':')).toHaveLength(3)

      // Model returns the decrypted, parsed value.
      const row = await Secret.find(1)
      expect(row?.payload).toEqual({ ssn: '123-45-6789', pin: 4242 })
    })

    test('toJSON emits decrypted value', async () => {
      await Secret.create({ payload: 'top secret' })
      const json = (await Secret.find(1))?.toJSON() as Record<string, unknown>
      expect(json.payload).toBe('top secret')
    })
  })
}

async function useRaw() {
  const { useConnection } = await import('../src/connection')
  return useConnection().select('SELECT payload FROM secrets WHERE id = 1', [])
}
