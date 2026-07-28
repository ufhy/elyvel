import type { Readable, Writable } from 'node:stream'
import { createInterface } from 'node:readline/promises'

const RESET = '\x1B[0m'
const CODE = {
  green: '\x1B[32m',
  yellow: '\x1B[33m',
  red: '\x1B[31m',
  gray: '\x1B[90m',
}

/** Only colorize when writing to a real terminal — a piped/redirected output gets plain text. */
function colorize(code: string, text: string, stream: Writable = process.stdout): string {
  return (stream as NodeJS.WriteStream).isTTY ? `${code}${text}${RESET}` : text
}

// ── Output ───────────────────────────────────────────────────────────────

/** Green — a successful/expected outcome. */
export function info(message: string): void {
  console.log(colorize(CODE.green, message))
}

/** Yellow — a warning that isn't necessarily an error. */
export function warn(message: string): void {
  console.log(colorize(CODE.yellow, message))
}

/** Red, to stderr — something failed. */
export function error(message: string): void {
  console.error(colorize(CODE.red, message))
}

/** Yellow, dimmer tone — an aside/note. */
export function comment(message: string): void {
  console.log(colorize(CODE.gray, message))
}

/** Plain, uncolored text. */
export function line(message: string): void {
  console.log(message)
}

/** One or more blank lines. */
export function newLine(count = 1): void {
  for (let i = 0; i < count; i++) console.log('')
}

/**
 * Render an aligned ASCII table (Laravel's `$this->table(...)`).
 *
 *   table(['Name', 'Email'], [['Ada', 'ada@x.io'], ['Alan', 'alan@x.io']])
 */
export function table(headers: string[], rows: (string | number)[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length)))
  const renderRow = (cells: (string | number)[]): string =>
    `| ${cells.map((c, i) => String(c).padEnd(widths[i]!)).join(' | ')} |`
  const separator = `+${widths.map(w => '-'.repeat(w + 2)).join('+')}+`

  console.log(separator)
  console.log(renderRow(headers))
  console.log(separator)
  for (const row of rows) console.log(renderRow(row))
  console.log(separator)
}

// ── Progress ─────────────────────────────────────────────────────────────

export interface ProgressBar {
  advance(step?: number): void
  finish(): void
}

/** A single-line, redrawn-in-place progress bar (Laravel's `$this->output->createProgressBar()`). */
export function progressBar(total: number, width = 30): ProgressBar {
  let current = 0
  const render = (): void => {
    const filled = total > 0 ? Math.round((current / total) * width) : width
    const bar = `${'='.repeat(filled)}${' '.repeat(width - filled)}`
    process.stdout.write(`\r[${bar}] ${current}/${total}`)
  }
  render()
  return {
    advance: (step = 1) => {
      current = Math.min(total, current + step)
      render()
    },
    finish: () => {
      current = total
      render()
      process.stdout.write('\n')
    },
  }
}

/** Iterate `items`, advancing a progress bar after each (Laravel's `withProgressBar`). */
export async function withProgressBar<T>(
  items: T[],
  fn: (item: T, index: number) => void | Promise<void>,
): Promise<T[]> {
  const bar = progressBar(items.length)
  for (const [index, item] of items.entries()) {
    await fn(item, index)
    bar.advance()
  }
  bar.finish()
  return items
}

// ── Interactive input ────────────────────────────────────────────────────

/** Streams to prompt against — defaults to the real terminal; injectable for tests. */
export interface PromptStreams {
  input?: Readable
  output?: Writable
}

async function prompt(question: string, streams: PromptStreams = {}): Promise<string> {
  const rl = createInterface({
    input: streams.input ?? process.stdin,
    output: streams.output ?? process.stdout,
  })
  try {
    return await rl.question(question)
  }
  finally {
    rl.close()
  }
}

/** Ask a free-text question; `defaultValue` is used if the answer is empty. */
export async function ask(question: string, defaultValue?: string, streams?: PromptStreams): Promise<string> {
  const suffix = defaultValue !== undefined ? ` [${defaultValue}]` : ''
  const answer = (await prompt(`${question}${suffix} `, streams)).trim()
  return answer || defaultValue || ''
}

/** Ask a yes/no question; `defaultValue` (default `false`) is used if the answer is empty. */
export async function confirm(question: string, defaultValue = false, streams?: PromptStreams): Promise<boolean> {
  const suffix = defaultValue ? 'Y/n' : 'y/N'
  const answer = (await prompt(`${question} (${suffix}) `, streams)).trim().toLowerCase()
  if (!answer)
    return defaultValue
  return answer === 'y' || answer === 'yes'
}

/** Ask the user to pick one of `options` by index; re-prompts on an invalid answer. */
export async function choice(
  question: string,
  options: string[],
  defaultIndex?: number,
  streams?: PromptStreams,
): Promise<string> {
  line(question)
  options.forEach((option, i) => line(`  [${i}] ${option}`))
  const defaultLabel = defaultIndex !== undefined ? ` [${defaultIndex}]` : ''

  for (;;) {
    const answer = (await prompt(`Your choice${defaultLabel}: `, streams)).trim()
    if (!answer && defaultIndex !== undefined)
      return options[defaultIndex]!
    const index = Number(answer)
    if (Number.isInteger(index) && index >= 0 && index < options.length)
      return options[index]!
    error('Invalid selection, try again.')
  }
}

// Raw single-character control codes read off stdin in raw mode.
const KEY_ENTER_LF = '\n'
const KEY_ENTER_CR = '\r'
const KEY_EOF = '' // Ctrl+D
const KEY_INTERRUPT = '' // Ctrl+C
const KEY_BACKSPACE_DEL = ''
const KEY_BACKSPACE_BS = '\b'

/**
 * Ask a question without echoing the answer to the terminal (a password).
 * Raw-mode stdin manipulation — only meaningful against a real TTY; falls
 * back to a plain (visible) `ask()` when `input` isn't one (e.g. piped/test
 * streams), since there's no terminal to suppress echo on.
 */
export async function secret(question: string, streams?: PromptStreams): Promise<string> {
  const input = (streams?.input ?? process.stdin) as NodeJS.ReadStream
  const output = (streams?.output ?? process.stdout) as NodeJS.WriteStream

  if (!input.isTTY || typeof input.setRawMode !== 'function')
    return ask(question, undefined, streams)

  output.write(question)
  return new Promise((resolve) => {
    const wasRaw = input.isRaw
    input.setRawMode(true)
    input.resume()
    input.setEncoding('utf8')

    let value = ''
    const onData = (char: string): void => {
      if (char === KEY_ENTER_LF || char === KEY_ENTER_CR || char === KEY_EOF) {
        input.setRawMode(wasRaw ?? false)
        input.pause()
        input.removeListener('data', onData)
        output.write('\n')
        resolve(value)
        return
      }
      if (char === KEY_INTERRUPT) {
        process.exit(130)
      }
      if (char === KEY_BACKSPACE_DEL || char === KEY_BACKSPACE_BS) {
        value = value.slice(0, -1)
        return
      }
      value += char
    }
    input.on('data', onData)
  })
}
