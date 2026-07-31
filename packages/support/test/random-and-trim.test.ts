import { describe, expect, test } from 'bun:test'
import { Arr } from '../src/arr'
import { Str, trimTrailing } from '../src/str'

/**
 * Regression: `Str.random` picked characters with `byte % 62`. A byte spans 256
 * values and 256 % 62 = 8, so `A`–`H` came up about 25% more often than the rest —
 * measured at a 28% skew over two million samples. The docstring reads as safe for
 * secrets, and the function is the obvious choice for reset tokens and API keys, so
 * a non-uniform alphabet directly shrinks their entropy.
 *
 * The threshold below discriminates: the old implementation put eight characters
 * ~25% over the mean, while sampling noise at this size stays under ~5%.
 */
describe('Str.random draws uniformly', () => {
  test('no character is meaningfully over-represented', () => {
    const counts = new Map<string, number>()
    const chars = 200_000
    for (let i = 0; i < chars / 20; i++) {
      for (const c of Str.random(20)) counts.set(c, (counts.get(c) ?? 0) + 1)
    }

    expect(counts.size).toBe(62)
    const mean = chars / 62
    for (const [char, n] of counts) {
      // Generous enough to never flake, tight enough that `byte % 62` fails it.
      expect(n, `character ${char} appeared ${n} times, mean ${Math.round(mean)}`)
        .toBeLessThan(mean * 1.15)
      expect(n).toBeGreaterThan(mean * 0.85)
    }
  })

  test('length and alphabet are respected', () => {
    expect(Str.random(1)).toHaveLength(1)
    expect(Str.random(64)).toHaveLength(64)
    expect(Str.random()).toHaveLength(16)
    expect(Str.random(200)).toMatch(/^[A-Z0-9]{200}$/i)
  })

  test('two calls do not collide', () => {
    const seen = new Set(Array.from({ length: 500 }, () => Str.random(16)))
    expect(seen.size).toBe(500)
  })
})

describe('Arr.random draws uniformly', () => {
  test('a three-element array is picked evenly', () => {
    const picks = [0, 0, 0]
    const rounds = 150_000
    for (let i = 0; i < rounds; i++) picks[Arr.random([0, 1, 2]) as number]!++

    const mean = rounds / 3
    for (const n of picks) {
      expect(n).toBeLessThan(mean * 1.05)
      expect(n).toBeGreaterThan(mean * 0.95)
    }
  })

  test('an empty array yields undefined, a single element always itself', () => {
    expect(Arr.random([])).toBeUndefined()
    expect(Arr.random(['only'])).toBe('only')
  })
})

/**
 * Regression: four call sites used `.replace(/\/+$/, '')`, which backtracks
 * quadratically — measured 51ms for 10k trailing slashes, 1.2s for 50k and 4.8s
 * for 100k. No call site takes that input from a request today, but one documented
 * pattern comes close: a `ScopedDisk` prefix built as `tenants/${tenantId}` runs it
 * on every file operation. An O(n) scan removes the class instead of arguing about
 * reachability.
 */
describe('trimTrailing', () => {
  test('strips only trailing occurrences', () => {
    expect(trimTrailing('/a/b///', '/')).toBe('/a/b')
    expect(trimTrailing('/a/b', '/')).toBe('/a/b')
    expect(trimTrailing('///', '/')).toBe('')
    expect(trimTrailing('', '/')).toBe('')
    expect(trimTrailing('a', '/')).toBe('a')
    // Leading and interior ones are left alone.
    expect(trimTrailing('//a//b//', '/')).toBe('//a//b')
  })

  test('works for any character', () => {
    expect(trimTrailing('name___', '_')).toBe('name')
    expect(trimTrailing('xxx', 'x')).toBe('')
  })

  test('stays linear where the regex went quadratic', () => {
    const pathological = `${'/'.repeat(1_000_000)}x`
    const startedAt = Bun.nanoseconds()
    expect(trimTrailing(pathological, '/')).toBe(pathological)
    const ms = (Bun.nanoseconds() - startedAt) / 1e6
    // The old regex needed ~4.8s for a tenth of this input.
    expect(ms).toBeLessThan(100)
  })
})
