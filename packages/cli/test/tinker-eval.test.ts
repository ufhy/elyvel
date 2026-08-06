import { describe, expect, test } from 'bun:test'
import { createReplContext, evaluateLine, IncompleteInputError } from '../src/tinker-eval'

/**
 * The REPL evaluator, tested as a function — no TTY involved. The two things a
 * naive eval loop gets wrong are the two things everyone types first in a
 * tinker session: `await`, and a `const` they expect to still exist on the next
 * line.
 */
describe('evaluateLine', () => {
  test('an expression echoes its value', async () => {
    const ctx = createReplContext()
    expect(await evaluateLine('1 + 2', ctx)).toBe(3)
  })

  test('a variable assigned on one line exists on the next', async () => {
    const ctx = createReplContext()
    await evaluateLine('x = 5', ctx)
    expect(await evaluateLine('x * 2', ctx)).toBe(10)
  })

  test('const/let/var survive the line they were declared on', async () => {
    const ctx = createReplContext()
    await evaluateLine('const a = 1', ctx)
    await evaluateLine('let b = 2', ctx)
    await evaluateLine('var c = 3', ctx)
    expect(await evaluateLine('a + b + c', ctx)).toBe(6)
  })

  test('await works on any line', async () => {
    const ctx = createReplContext()
    expect(await evaluateLine('await Promise.resolve(41) + 1', ctx)).toBe(42)
  })

  /** The tinker workflow: pull a module in, keep using its exports. */
  test('a destructured await import persists its bindings', async () => {
    const ctx = createReplContext()
    // node:path rather than an @elyvel package: imports resolve from THIS
    // package, and the CLI deliberately depends on almost nothing.
    await evaluateLine('const { join } = await import("node:path")', ctx)
    expect(await evaluateLine('join("a", "b")', ctx)).toBe('a/b')
  })

  test('class and function declarations persist', async () => {
    const ctx = createReplContext()
    // eslint-disable-next-line no-template-curly-in-string -- the template literal is REPL input under test
    await evaluateLine('class Greeter { hi(name) { return `hi ${name}` } }', ctx)
    expect(await evaluateLine('new Greeter().hi("Ada")', ctx)).toBe('hi Ada')

    await evaluateLine('function double(n) { return n * 2 }', ctx)
    expect(await evaluateLine('double(21)', ctx)).toBe(42)
  })

  test('seeded values are visible, and real globals still resolve', async () => {
    const ctx = createReplContext({ answer: 42 })
    expect(await evaluateLine('answer', ctx)).toBe(42)
    expect(await evaluateLine('JSON.stringify({ ok: true })', ctx)).toBe('{"ok":true}')
  })

  test('a session variable shadows a global without touching it', async () => {
    const ctx = createReplContext()
    await evaluateLine('JSON = "mine"', ctx)
    expect(await evaluateLine('JSON', ctx)).toBe('mine')
    expect(globalThis.JSON.stringify).toBeDefined() // the real one is untouched
  })

  test('`_` holds the last non-undefined result', async () => {
    const ctx = createReplContext()
    await evaluateLine('7 * 6', ctx)
    expect(await evaluateLine('_', ctx)).toBe(42)
    // undefined results leave `_` alone, as node's REPL does
    await evaluateLine('undefined', ctx)
    expect(await evaluateLine('_', ctx)).toBe(42)
  })

  test('statements that are not expressions still run', async () => {
    const ctx = createReplContext()
    await evaluateLine('if (true) { x = "from-if" }', ctx)
    expect(await evaluateLine('x', ctx)).toBe('from-if')
  })

  test('a thrown error propagates with its message', async () => {
    const ctx = createReplContext()
    expect(evaluateLine('throw new Error("boom")', ctx)).rejects.toThrow('boom')
  })

  test('a genuine typo is a SyntaxError, not a hang', async () => {
    const ctx = createReplContext()
    expect(evaluateLine('const = 5', ctx)).rejects.toThrow(SyntaxError)
  })

  /** The REPL uses this to switch into multi-line mode instead of erroring. */
  test('an unfinished block signals IncompleteInputError', async () => {
    const ctx = createReplContext()
    expect(evaluateLine('if (true) {', ctx)).rejects.toThrow(IncompleteInputError)
  })

  test('two sessions do not share variables', async () => {
    const a = createReplContext()
    const b = createReplContext()
    await evaluateLine('x = "a"', a)
    expect(await evaluateLine('typeof x', b)).toBe('undefined')
  })
})
