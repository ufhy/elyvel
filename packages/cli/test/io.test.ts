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
    // @ts-expect-error — narrowing for the test capture only
    process.stdout.write = (chunk: string) => {
      writes.push(chunk)
      return true
    }
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
})
