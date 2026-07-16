import { describe, expect, test } from 'bun:test'
import { Container, token } from '../src/container'
import { createLogger } from '../src/logger'

describe('Container extras', () => {
  test('bindIf/singletonIf do not overwrite; forget/flush clear', () => {
    const c = new Container()
    const T = token<string>('t')
    c.bindIf(T, () => 'first')
    c.bindIf(T, () => 'second') // ignored — already bound
    expect(c.make(T)).toBe('first')
    expect(c.bound(T)).toBe(true)

    c.forget(T)
    expect(c.has(T)).toBe(false)

    c.singleton(T, () => 'x')
    c.flush()
    expect(c.has(T)).toBe(false)
  })
})

describe('Logger extras', () => {
  test('log(level) + withContext merge into entries', () => {
    const entries: { level: string, message: string, context?: Record<string, unknown> }[] = []
    const logger = createLogger({
      level: 'debug',
      transports: [{ log: e => entries.push(e) }],
    })
    logger.log('warn', 'hey', { a: 1 })
    logger.withContext({ requestId: 'r1' }).info('scoped')

    expect(entries[0]).toMatchObject({ level: 'warn', message: 'hey' })
    expect(entries[1]?.context).toMatchObject({ requestId: 'r1' })
  })
})
