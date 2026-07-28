import { describe, expect, test } from 'bun:test'
import { elyvelCommands } from '../src/cli'

describe('elyvelCommands (discovered by `elyvel package:discover`)', () => {
  test('every command has a namespaced name, a description, and a run function', () => {
    expect(elyvelCommands.length).toBeGreaterThan(0)
    for (const command of elyvelCommands) {
      expect(command.name).toMatch(/^schedule:/)
      expect(typeof command.description).toBe('string')
      expect(command.description.length).toBeGreaterThan(0)
      expect(typeof command.run).toBe('function')
    }
  })

  test('covers every documented schedule: command', () => {
    const names = elyvelCommands.map(c => c.name).sort()
    expect(names).toEqual(['schedule:list', 'schedule:run', 'schedule:test', 'schedule:work'])
  })
})
