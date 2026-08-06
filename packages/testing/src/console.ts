import type { ConsoleCommand } from '@elyvel/core'
import { parseArgs } from '@elyvel/cli'

/**
 * Run a console command in-process and assert on what it printed and how it
 * exited — Laravel's `$this->artisan('inspire')->assertExitCode(0)`.
 *
 * Without this, testing a command meant spawning `elyvel` as a child process:
 * seconds per test instead of milliseconds, no shared fixtures (a fake queue or
 * an in-memory SQLite set up by the test lives in the wrong process), and exit
 * codes read back through a shell.
 *
 * ```ts
 * const result = await runCommand(routeListCommand, 'route:list --json')
 * result.assertSuccessful().expectsOutput('/users/:id')
 * ```
 */
export async function runCommand(
  command: ConsoleCommand,
  argv: string | string[] = [],
): Promise<ConsoleResult> {
  // Same parser the real CLI uses on process.argv — a string here behaves
  // exactly like typing it after `elyvel <name>`.
  const parts = typeof argv === 'string' ? argv.split(/\s+/).filter(Boolean) : argv
  const { positionals, flags } = parseArgs(parts)

  const lines: string[] = []
  const original = { log: console.log, error: console.error, warn: console.warn }
  const capture = (...args: unknown[]) =>
    void lines.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))
  console.log = capture
  console.error = capture
  console.warn = capture

  let exitCode: number
  try {
    exitCode = await command.run(flags, positionals)
  }
  catch (error) {
    // A command that throws is a failed command, not a broken test harness —
    // the error text becomes output so `expectsOutput` can assert on it, and
    // the exit code is the conventional 1.
    lines.push(error instanceof Error ? error.message : String(error))
    exitCode = 1
  }
  finally {
    console.log = original.log
    console.error = original.error
    console.warn = original.warn
  }

  return new ConsoleResult(command.name, exitCode, lines)
}

/** What a command run produced, with chainable assertions. */
export class ConsoleResult {
  constructor(
    private readonly commandName: string,
    readonly exitCode: number,
    readonly lines: string[],
  ) {}

  /** Everything printed, joined — stdout and stderr interleaved, colors stripped. */
  get output(): string {
    return this.lines.map(stripAnsi).join('\n')
  }

  assertExitCode(code: number): this {
    if (this.exitCode !== code) {
      throw new Error(
        `Expected [${this.commandName}] to exit with code ${code}, but it exited with ${this.exitCode}${this.tail()}`,
      )
    }
    return this
  }

  assertSuccessful(): this {
    return this.assertExitCode(0)
  }

  assertFailed(): this {
    if (this.exitCode === 0) {
      throw new Error(
        `Expected [${this.commandName}] to fail, but it exited with 0${this.tail()}`,
      )
    }
    return this
  }

  /** Assert something printed contains this text (or matches this pattern). */
  expectsOutput(expected: string | RegExp): this {
    const hit = typeof expected === 'string'
      ? this.output.includes(expected)
      : expected.test(this.output)
    if (!hit) {
      throw new Error(
        `Expected [${this.commandName}] to print ${String(expected)}, but it did not${this.tail()}`,
      )
    }
    return this
  }

  doesntExpectOutput(unexpected: string | RegExp): this {
    const hit = typeof unexpected === 'string'
      ? this.output.includes(unexpected)
      : unexpected.test(this.output)
    if (hit)
      throw new Error(`Expected [${this.commandName}] NOT to print ${String(unexpected)}, but it did.`)
    return this
  }

  /** The actual output, appended to every failure so the diagnosis is in the message. */
  private tail(): string {
    if (this.lines.length === 0)
      return '. It printed nothing.'
    const shown = this.lines.slice(0, 10).map(l => `  ${stripAnsi(l)}`)
    return `. Output:\n${shown.join('\n')}${this.lines.length > 10 ? '\n  …' : ''}`
  }
}

/** io.ts colorizes; assertions should match what a human reads, not ANSI codes. */
function stripAnsi(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1B\[[0-9;]*m/g, '')
}
