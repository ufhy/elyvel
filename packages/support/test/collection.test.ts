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
    const admins = c.filter(p => p.role === 'admin')
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
    expect(c.sortBy(p => -p.age).first()?.name).toBe('Grace')
    expect(c.sum('age')).toBe(122)
    expect(c.avg('age')).toBeCloseTo(40.67, 1)
    expect(c.max('age')).toBe(45)
  })

  test('chunk / partition', () => {
    const c = new Collection([1, 2, 3, 4, 5])
    expect(c.chunk(2).count()).toBe(3)
    const [even, odd] = c.partition(n => n % 2 === 0)
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

  test('reject / flatMap / flatten', () => {
    const c = new Collection([1, 2, 3, 4])
    expect(c.reject(n => n % 2 === 0).all()).toEqual([1, 3])
    expect(c.flatMap(n => [n, n * 10]).all()).toEqual([1, 10, 2, 20, 3, 30, 4, 40])
    expect(new Collection([1, [2, [3]]]).flatten().all()).toEqual([1, 2, 3])
    expect(new Collection([1, [2, [3]]]).flatten(1).all()).toEqual([1, 2, [3]])
  })

  test('unique by identity and by selector', () => {
    expect(new Collection([1, 1, 2, 3, 3]).unique().all()).toEqual([1, 2, 3])
    expect(new Collection(people).unique('role').pluck('name').all()).toEqual(['Ada', 'Alan'])
  })

  test('reverse / sortByDesc / take / skip / slice', () => {
    const c = new Collection([1, 2, 3, 4, 5])
    expect(c.reverse().all()).toEqual([5, 4, 3, 2, 1])
    expect(new Collection(people).sortByDesc('age').first()?.name).toBe('Grace')
    expect(c.take(2).all()).toEqual([1, 2])
    expect(c.take(-2).all()).toEqual([4, 5])
    expect(c.skip(3).all()).toEqual([4, 5])
    expect(c.slice(1, 2).all()).toEqual([2, 3])
  })

  test('concat / merge / diff / intersect', () => {
    const c = new Collection([1, 2, 3])
    expect(c.concat([4, 5]).all()).toEqual([1, 2, 3, 4, 5])
    expect(c.merge(new Collection([4])).all()).toEqual([1, 2, 3, 4])
    expect(c.diff([2]).all()).toEqual([1, 3])
    expect(c.intersect([2, 3, 9]).all()).toEqual([2, 3])
  })

  test('implode / countBy / mapWithKeys', () => {
    expect(new Collection(people).implode(', ', 'name')).toBe('Ada, Alan, Grace')
    expect(new Collection([1, 2, 3]).implode('-')).toBe('1-2-3')
    expect(new Collection(people).countBy('role')).toEqual({ admin: 2, user: 1 })
    expect(new Collection(people).mapWithKeys(p => [p.name, p.age])).toEqual({ Ada: 36, Alan: 41, Grace: 45 })
  })

  test('pipe / whenEmpty / whenNotEmpty', () => {
    expect(new Collection([1, 2, 3]).pipe(c => c.sum())).toBe(6)
    let flag = ''
    new Collection<number>([]).whenEmpty(() => (flag = 'empty'))
    expect(flag).toBe('empty')
    new Collection([1]).whenNotEmpty(() => (flag = 'not-empty'))
    expect(flag).toBe('not-empty')
  })

  test('sole returns the single match or throws', () => {
    expect(new Collection(people).sole(p => p.name === 'Ada').age).toBe(36)
    expect(() => new Collection(people).sole(p => p.role === 'admin')).toThrow(/2 items matched/)
    expect(() => new Collection(people).sole(p => p.name === 'Nobody')).toThrow(/no matching/)
  })
})
