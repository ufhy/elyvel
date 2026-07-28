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

  describe('extend', () => {
    test('wraps a singleton once, before it is first resolved', () => {
      const c = new Container()
      const Svc = token<{ id: number }>('svc')
      let calls = 0
      c.singleton(Svc, () => ({ id: ++calls }))
      c.extend(Svc, value => ({ id: value.id * 10 }))

      const a = c.make(Svc)
      const b = c.make(Svc)
      expect(a).toBe(b) // still cached as one instance
      expect(a.id).toBe(10)
      expect(calls).toBe(1) // factory only ran once
    })

    test('wraps an already-resolved singleton immediately', () => {
      const c = new Container()
      const Svc = token<{ id: number }>('svc')
      c.singleton(Svc, () => ({ id: 1 }))
      c.make(Svc) // resolve + cache before extend()
      c.extend(Svc, value => ({ id: value.id + 100 }))

      expect(c.make(Svc).id).toBe(101)
    })

    test('wraps a plain bind fresh on every make (no caching)', () => {
      const c = new Container()
      const Counter = token<{ n: number }>('counter')
      let calls = 0
      c.bind(Counter, () => ({ n: ++calls }))
      c.extend(Counter, value => ({ n: value.n * 100 }))

      expect(c.make(Counter).n).toBe(100)
      expect(c.make(Counter).n).toBe(200)
    })

    test('wraps an instance() value immediately', () => {
      const c = new Container()
      const Cfg = token<string>('cfg')
      c.instance(Cfg, 'hello')
      c.extend(Cfg, value => `${value} world`)

      expect(c.make(Cfg)).toBe('hello world')
    })

    test('multiple extenders apply in registration order', () => {
      const c = new Container()
      const Svc = token<string>('svc')
      c.singleton(Svc, () => 'base')
      c.extend(Svc, value => `${value}-a`)
      c.extend(Svc, value => `${value}-b`)

      expect(c.make(Svc)).toBe('base-a-b')
    })

    test('flush clears registered extenders too', () => {
      const c = new Container()
      const Svc = token<string>('svc')
      c.singleton(Svc, () => 'base')
      c.extend(Svc, value => `${value}-extended`)
      c.flush()
      c.singleton(Svc, () => 'base')

      expect(c.make(Svc)).toBe('base')
    })
  })
})
