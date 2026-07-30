import { PassThrough } from 'node:stream'
import { describe, expect, test } from 'bun:test'
import { ask, choice, confirm, progressBar, table } from '../src/io'

/** Capture whatever `console.log`/`console.error` write during `fn()`. */
function captureConsole(fn: () => void): string[] {
  const lines: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: unknown[]) => lines.push(args.join(' '))
  console.error = (...args: unknown[]) => lines.push(args.join(' '))
  try {
    fn()
  }
  finally {
    console.log = originalLog
    console.error = originalError
  }
  return lines
}

/** A fake TTY-less input stream that answers with the given lines, one per `question()` call. */
function fakeInput(...answers: string[]): { input: PassThrough, output: PassThrough } {
  const input = new PassThrough()
  const output = new PassThrough()
  output.on('data', () => {}) // drain so writes don't back up
  let i = 0
  input.on('resume', () => {
    if (i < answers.length)
      queueMicrotask(() => input.write(`${answers[i++]}\n`))
  })
  return { input, output }
}

describe('table', () => {
  test('renders aligned columns with a header and border', () => {
    const lines = captureConsole(() => {
      table(['Name', 'Email'], [['Ada', 'ada@x.io'], ['Alan Turing', 'alan@x.io']])
    })
    expect(lines[0]).toBe(lines[2]) // top border === header separator
    expect(lines[1]).toContain('Name')
    expect(lines[1]).toContain('Email')
    // Column width follows the longest cell ("Alan Turing"), not the header.
    expect(lines.some(l => l.includes('Alan Turing'))).toBe(true)
    expect(lines.every(l => l.length === lines[0]!.length)).toBe(true)
  })

  test('handles zero rows without throwing', () => {
    expect(() => table(['A'], [])).not.toThrow()
  })
})

describe('progressBar', () => {
  test('advance() moves toward total, finish() completes it and prints a trailing newline', () => {
    const writes: string[] = []
    const original = process.stdout.write.bind(process.stdout)
    // A narrower signature than the real `write`, which is all this capture needs.
    process.stdout.write = ((chunk: string) => {
      writes.push(chunk)
      return true
    }) as typeof process.stdout.write
    try {
      const bar = progressBar(4)
      bar.advance()
      bar.advance(2)
      bar.finish()
    }
    finally {
      process.stdout.write = original
    }
    expect(writes[0]).toContain('0/4')
    expect(writes.at(-2)).toContain('4/4')
    expect(writes.at(-1)).toBe('\n')
  })
})

describe('interactive prompts (fake streams, no real TTY)', () => {
  test('ask() returns the typed answer', async () => {
    const { input, output } = fakeInput('Ada')
    expect(await ask('Name?', undefined, { input, output })).toBe('Ada')
  })

  test('ask() falls back to the default on an empty answer', async () => {
    const { input, output } = fakeInput('')
    expect(await ask('Name?', 'Anon', { input, output })).toBe('Anon')
  })

  test('confirm() accepts y/yes as true, defaults otherwise', async () => {
    const yes = fakeInput('y')
    expect(await confirm('Continue?', false, yes)).toBe(true)

    const empty = fakeInput('')
    expect(await confirm('Continue?', true, empty)).toBe(true)

    const no = fakeInput('n')
    expect(await confirm('Continue?', true, no)).toBe(false)
  })

  test('choice() resolves a valid numeric index', async () => {
    const { input, output } = fakeInput('1')
    const result = await choice('Pick one', ['a', 'b', 'c'], undefined, { input, output })
    expect(result).toBe('b')
  })

  test('choice() falls back to the default index on an empty answer', async () => {
    const { input, output } = fakeInput('')
    const result = await choice('Pick one', ['a', 'b', 'c'], 2, { input, output })
    expect(result).toBe('c')
  })

  test('choice() re-prompts on an invalid index before accepting a valid one', async () => {
    const { input, output } = fakeInput('nope', '99', '0')
    const result = await choice('Pick one', ['a', 'b'], undefined, { input, output })
    expect(result).toBe('a')
  })

  test('choice() gives up after a bounded number of invalid answers', async () => {
    // Without a bound, an input that never produces a valid index printed
    // "Invalid selection, try again." forever.
    const { input, output } = fakeInput('x', 'y', 'z', 'still-bad')
    await expect(
      choice('Pick one', ['a', 'b'], undefined, { input, output }),
    ).rejects.toThrow(/after 3 attempts/)
  })
})

/**
 * Regression: `rl.question()` never settles once the input stream has ended, so
 * a prompt on a closed or non-interactive stdin — CI, a piped command, `elyvel`
 * invoked from a script — hung the entire command forever with no output and no
 * error. It now fails with an actionable message.
 */
describe('prompts on a closed stdin fail instead of hanging', () => {
  function closedInput(): { input: PassThrough, output: PassThrough } {
    const input = new PassThrough()
    const output = new PassThrough()
    output.on('data', () => {})
    input.end() // real EOF, as a non-interactive stdin gives
    return { input, output }
  }

  test('ask() rejects with guidance rather than waiting forever', async () => {
    const { input, output } = closedInput()
    await expect(ask('Name?', undefined, { input, output }))
      .rejects
      .toThrow(/stdin is closed or not interactive/)
  })

  test('confirm() rejects too', async () => {
    const { input, output } = closedInput()
    await expect(confirm('Sure?', false, { input, output }))
      .rejects
      .toThrow(/stdin is closed or not interactive/)
  })

  test('choice() rejects too', async () => {
    const { input, output } = closedInput()
    await expect(choice('Pick one', ['a', 'b'], undefined, { input, output }))
      .rejects
      .toThrow(/stdin is closed or not interactive/)
  })
})
