import { describe, expect, test } from 'bun:test'
import { Arr } from '../src/arr'
import { blank, dataGet, filled, retry, tap, value } from '../src/helpers'

describe('Arr', () => {
  test('get by dot path with fallback', () => {
    const data = { user: { name: 'Ada', roles: ['admin', 'editor'] } }
    expect(Arr.get<string>(data, 'user.name')).toBe('Ada')
    expect(Arr.get<string>(data, 'user.roles.1')).toBe('editor')
    expect(Arr.get(data, 'user.missing', 'def')).toBe('def')
    expect(Arr.get(data, 'user.name.nope', 'def')).toBe('def')
  })

  test('has', () => {
    const data = { a: { b: null } }
    expect(Arr.has(data, 'a.b')).toBe(true)
    expect(Arr.has(data, 'a.c')).toBe(false)
  })

  test('set / forget mutate the target', () => {
    const data: Record<string, unknown> = {}
    Arr.set(data, 'a.b.c', 1)
    expect(data).toEqual({ a: { b: { c: 1 } } })
    Arr.forget(data, 'a.b.c')
    expect(Arr.has(data, 'a.b.c')).toBe(false)
  })

  test('only / except', () => {
    const data = { a: 1, b: 2, c: 3 }
    expect(Arr.only(data, ['a', 'c'])).toEqual({ a: 1, c: 3 })
    expect(Arr.except(data, ['b'])).toEqual({ a: 1, c: 3 })
  })

  test('pluck (list and keyed)', () => {
    const rows = [{ id: 1, name: 'a' }, { id: 2, name: 'b' }]
    expect(Arr.pluck(rows, 'name')).toEqual(['a', 'b'])
    expect(Arr.pluck(rows, 'name', 'id')).toEqual({ 1: 'a', 2: 'b' })
  })

  test('wrap', () => {
    expect(Arr.wrap('x')).toEqual(['x'])
    expect(Arr.wrap(['x'])).toEqual(['x'])
    expect(Arr.wrap(null)).toEqual([])
  })

  test('first / last with predicate', () => {
    expect(Arr.first([1, 2, 3], n => n > 1)).toBe(2)
    expect(Arr.last([1, 2, 3], n => n < 3)).toBe(2)
    expect(Arr.first([], undefined, 'def')).toBe('def')
  })

  test('flatten / collapse', () => {
    expect(Arr.flatten([1, [2, [3, [4]]]])).toEqual([1, 2, 3, 4])
    expect(Arr.flatten([1, [2, [3]]], 1)).toEqual([1, 2, [3]])
    expect(Arr.collapse([[1, 2], [3], [4]])).toEqual([1, 2, 3, 4])
  })
})

describe('helpers', () => {
  test('tap runs the side-effect and returns the value', () => {
    const seen: number[] = []
    const result = tap(5, v => seen.push(v))
    expect(result).toBe(5)
    expect(seen).toEqual([5])
  })

  test('value resolves thunks', () => {
    expect(value(5)).toBe(5)
    expect(value(() => 7)).toBe(7)
  })

  test('blank / filled', () => {
    expect(blank('')).toBe(true)
    expect(blank('  ')).toBe(true)
    expect(blank([])).toBe(true)
    expect(blank({})).toBe(true)
    expect(blank(null)).toBe(true)
    expect(blank(0)).toBe(false) // 0 is filled
    expect(filled('0')).toBe(true)
    expect(filled('x')).toBe(true)
  })

  test('dataGet is Arr.get', () => {
    expect(dataGet<number>({ a: { b: 2 } }, 'a.b')).toBe(2)
  })

  test('retry succeeds on a later attempt', async () => {
    let tries = 0
    const result = await retry(3, () => {
      tries++
      if (tries < 3)
        throw new Error('nope')
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(tries).toBe(3)
  })

  test('retry rethrows after exhausting attempts', async () => {
    await expect(retry(2, () => {
      throw new Error('always')
    })).rejects.toThrow('always')
  })

  test('retry honors the when() gate', async () => {
    let tries = 0
    const attempt = () => {
      tries++
      throw new Error('fatal')
    }
    await expect(
      retry(5, attempt, 0, e => (e as Error).message !== 'fatal'),
    ).rejects.toThrow('fatal')
    expect(tries).toBe(1) // not retried — when() returned false
  })
})
