import type { ConsoleCommand } from '@elyvel/core'
import { describe, expect, test } from 'bun:test'
import { runCommand } from '../src/console'

/** A command shaped exactly like the ones packages export via elyvelCommands. */
const greet: ConsoleCommand = {
  name: 'greet',
  description: 'Greets someone',
  run(flags, args) {
    if (flags.shout) {
      console.log(`HELLO ${String(args[0] ?? 'WORLD').toUpperCase()}`)
      return 0
    }
    if (!args[0]) {
      console.error('Who am I greeting?')
      return 1
    }
    console.log(`Hello ${args[0]}`)
    return 0
  },
}

const boom: ConsoleCommand = {
  name: 'boom',
  description: 'Always throws',
  run() {
    throw new Error('the disk is on fire')
  },
}

/**
 * Laravel's `$this->artisan(...)`. Without it, testing a command means spawning
 * the CLI as a child process — seconds instead of milliseconds, and fixtures
 * (a fake queue, in-memory SQLite) live in the wrong process.
 */
describe('runCommand', () => {
  test('runs in-process, capturing output and exit code', async () => {
    const result = await runCommand(greet, 'Ada')
    result.assertSuccessful().expectsOutput('Hello Ada')
    expect(result.exitCode).toBe(0)
  })

  test('a string argv is parsed like the real CLI parses process.argv', async () => {
    const result = await runCommand(greet, 'ada --shout')
    result.assertSuccessful().expectsOutput('HELLO ADA')
  })

  test('an array argv works the same', async () => {
    const result = await runCommand(greet, ['ada', '--shout'])
    result.expectsOutput('HELLO ADA')
  })

  test('stderr is captured too, and a non-zero exit asserts as failed', async () => {
    const result = await runCommand(greet)
    result.assertFailed().expectsOutput('Who am I greeting?')
    expect(() => result.assertSuccessful()).toThrow(/exited with 1/)
  })

  test('a command that throws becomes exit 1 with the error as output', async () => {
    const result = await runCommand(boom)
    result.assertFailed().expectsOutput('the disk is on fire')
  })

  test('a failed output assertion shows what WAS printed', async () => {
    const result = await runCommand(greet, 'Ada')
    expect(() => result.expectsOutput('Goodbye')).toThrow(/Output:\n {2}Hello Ada/)
  })

  test('doesntExpectOutput', async () => {
    const result = await runCommand(greet, 'Ada')
    result.doesntExpectOutput('Goodbye')
    expect(() => result.doesntExpectOutput('Hello')).toThrow(/NOT to print/)
  })

  test('console.log is restored even when the command throws', async () => {
    const original = console.log
    await runCommand(boom)
    expect(console.log).toBe(original)
  })

  test('ANSI colors are stripped before matching — assert what a human reads', async () => {
    const colored: ConsoleCommand = {
      name: 'colored',
      description: '',
      run() {
        console.log('\x1B[32m✓ done\x1B[0m')
        return 0
      },
    }
    const result = await runCommand(colored)
    result.expectsOutput('✓ done')
  })
})
