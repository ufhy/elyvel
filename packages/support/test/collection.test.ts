import { describe, expect, test } from 'bun:test'
import { Collection } from '../src/collection'

const people = [
  { name: 'Ada', role: 'admin', age: 36 },
  { name: 'Alan', role: 'user', age: 41 },
  { name: 'Grace', role: 'admin', age: 45 },
]

describe('Collection', () => {
  test('map/filter/first/count are chainable and non-mutating', () => {
    const c = new Collection(people)
    const admins = c.filter((p) => p.role === 'admin')
    expect(admins.count()).toBe(2)
    expect(c.count()).toBe(3) // original untouched
    expect(admins.first()?.name).toBe('Ada')
  })

  test('pluck / where / firstWhere', () => {
    const c = new Collection(people)
    expect(c.pluck('name').all()).toEqual(['Ada', 'Alan', 'Grace'])
    expect(c.where('role', 'admin').count()).toBe(2)
    expect(c.firstWhere('name', 'Grace')?.age).toBe(45)
  })

  test('keyBy / groupBy', () => {
    const c = new Collection(people)
    expect(c.keyBy('name').Ada?.role).toBe('admin')
    const grouped = c.groupBy('role')
    expect(grouped.admin?.count()).toBe(2)
    expect(grouped.user?.count()).toBe(1)
  })

  test('sortBy (non-mutating) + aggregates', () => {
    const c = new Collection(people)
    expect(c.sortBy('age').first()?.name).toBe('Ada')
    expect(c.sortBy((p) => -p.age).first()?.name).toBe('Grace')
    expect(c.sum('age')).toBe(122)
    expect(c.avg('age')).toBeCloseTo(40.67, 1)
    expect(c.max('age')).toBe(45)
  })

  test('chunk / partition', () => {
    const c = new Collection([1, 2, 3, 4, 5])
    expect(c.chunk(2).count()).toBe(3)
    const [even, odd] = c.partition((n) => n % 2 === 0)
    expect(even.all()).toEqual([2, 4])
    expect(odd.all()).toEqual([1, 3, 5])
  })

  test('toArray unwraps model-aware items via toObject()', () => {
    const model = { toObject: () => ({ id: 1, name: 'Ada' }) }
    expect(new Collection([model]).toArray()).toEqual([{ id: 1, name: 'Ada' }])
  })

  test('is iterable', () => {
    expect([...new Collection([1, 2, 3])]).toEqual([1, 2, 3])
  })
})
