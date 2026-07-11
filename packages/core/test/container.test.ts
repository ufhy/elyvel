import { describe, expect, test } from 'bun:test'
import { Container, token } from '../src/container'

describe('Container', () => {
  test('bind resolves a fresh value on every make', () => {
    const c = new Container()
    const Counter = token<{ n: number }>('counter')
    let calls = 0
    c.bind(Counter, () => ({ n: ++calls }))

    expect(c.make(Counter).n).toBe(1)
    expect(c.make(Counter).n).toBe(2)
  })

  test('singleton resolves once then caches', () => {
    const c = new Container()
    const Svc = token<{ id: number }>('svc')
    let calls = 0
    c.singleton(Svc, () => ({ id: ++calls }))

    const a = c.make(Svc)
    const b = c.make(Svc)
    expect(a).toBe(b)
    expect(calls).toBe(1)
  })

  test('instance registers a prebuilt value', () => {
    const c = new Container()
    const Cfg = token<string>('cfg')
    c.instance(Cfg, 'hello')
    expect(c.make(Cfg)).toBe('hello')
  })

  test('has reflects registration', () => {
    const c = new Container()
    const A = token<number>('a')
    expect(c.has(A)).toBe(false)
    c.bind(A, () => 1)
    expect(c.has(A)).toBe(true)
  })

  test('make throws a helpful error for unbound tokens', () => {
    const c = new Container()
    expect(() => c.make(token('missing'))).toThrow(/No binding registered/)
  })
})
