import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { loadAppCommands } from '../src/commands/app-commands'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'elyvel-app-commands-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function write(rel: string, body: string): void {
  const file = join(dir, rel)
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, body)
}

describe('loadAppCommands', () => {
  test('empty directory — no commands', async () => {
    expect(await loadAppCommands(dir)).toEqual([])
  })

  test('loads a default-exported ConsoleCommand', async () => {
    write('SendReminders.ts', `
      export default {
        name: 'send-reminders',
        description: 'Send reminders',
        run: () => 0,
      }
    `)
    const commands = await loadAppCommands(dir)
    expect(commands).toHaveLength(1)
    expect(commands[0]?.name).toBe('send-reminders')
  })

  test('skips a file with no matching default export, without throwing', async () => {
    write('NotACommand.ts', `export const somethingElse = 1`)
    expect(await loadAppCommands(dir)).toEqual([])
  })

  test('skips .d.ts and .test.ts files', async () => {
    write('SendReminders.d.ts', `export default {} as any`)
    write('SendReminders.test.ts', `export default {} as any`)
    expect(await loadAppCommands(dir)).toEqual([])
  })

  test('loads files in a stable sorted order', async () => {
    write('B.ts', `export default { name: 'b', description: 'B', run: () => 0 }`)
    write('A.ts', `export default { name: 'a', description: 'A', run: () => 0 }`)
    const commands = await loadAppCommands(dir)
    expect(commands.map(c => c.name)).toEqual(['a', 'b'])
  })
})
