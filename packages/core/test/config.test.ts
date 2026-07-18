import { describe, expect, test } from 'bun:test'
import { ConfigRepository } from '../src/config'

const repo = new ConfigRepository({
  app: { name: 'Elyvel', port: 3000, nested: { deep: true } },
})

describe('ConfigRepository', () => {
  test('resolves dot-paths', () => {
    expect(repo.get<string>('app.name')).toBe('Elyvel')
    expect(repo.get<number>('app.port')).toBe(3000)
    expect(repo.get<boolean>('app.nested.deep')).toBe(true)
  })

  test('returns fallback for missing paths', () => {
    expect(repo.get('app.missing', 'default')).toBe('default')
    expect(repo.get('nope.at.all', 42)).toBe(42)
    expect(repo.get('app.missing')).toBeUndefined()
  })

  test('has reports presence', () => {
    expect(repo.has('app.name')).toBe(true)
    expect(repo.has('app.missing')).toBe(false)
    expect(repo.has('app.nested.deep')).toBe(true)
  })
})
