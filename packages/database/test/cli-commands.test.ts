import { describe, expect, test } from 'bun:test'
import { elyvelCommands } from '../src/cli'

describe('elyvelCommands (discovered by `elyvel package:discover`)', () => {
  test('every command has a name, a description, and a run function', () => {
    expect(elyvelCommands.length).toBeGreaterThan(0)
    for (const command of elyvelCommands) {
      expect(typeof command.name).toBe('string')
      expect(command.name.length).toBeGreaterThan(0)
      expect(typeof command.description).toBe('string')
      expect(command.description.length).toBeGreaterThan(0)
      expect(typeof command.run).toBe('function')
    }
  })

  test('covers every documented migrate/db/model command', () => {
    const names = elyvelCommands.map(c => c.name).sort()
    expect(names).toEqual([
      'db',
      'db:monitor',
      'db:show',
      'db:table',
      'migrate',
      'migrate:fresh',
      'migrate:refresh',
      'migrate:reset',
      'migrate:rollback',
      'migrate:status',
      'migrate:unlock',
      'model:prune',
      'model:sync',
      'db:seed',
      'schema:dump',
    ].sort())
  })
})
