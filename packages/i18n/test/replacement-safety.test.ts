import { describe, expect, test } from 'bun:test'
import { Translator } from '../src/translator'

describe('placeholder replacement is inert to hostile values', () => {
  /**
   * Regression: `String.replace(re, value)` leaves `$&`, `` $` ``, `$'`, `$1`
   * and `$$` ACTIVE inside the *replacement value*. A user-controlled `:name`
   * of `$'` spliced in whatever text followed the placeholder.
   */
  test('regex replacement patterns in a value are literal text', () => {
    const t = new Translator({ locale: 'en' })
    t.addLines('en', { line: 'X :one Y' })
    expect(t.get('line', { one: '$& $1 $` $\' $$' })).toBe('X $& $1 $` $\' $$ Y')
  })

  /**
   * Regression: each key was applied in its own sequential pass, which
   * re-scanned text an earlier key had already substituted. A user whose name
   * was `:secret` got the *secret* rendered in place of their name.
   */
  test('a value that looks like another placeholder is not expanded again', () => {
    const t = new Translator({ locale: 'en' })
    t.addLines('en', { greet: 'Hi :name, your code is :secret' })
    const out = t.get('greet', { name: ':secret', secret: 'p@ssw0rd' })
    expect(out).toBe('Hi :secret, your code is p@ssw0rd')
    // The secret appears exactly once — where it belongs.
    expect(out.split('p@ssw0rd')).toHaveLength(2)
  })

  test('casing variants and word boundaries still behave', () => {
    const t = new Translator({ locale: 'en' })
    t.addLines('en', { c: ':name / :Name / :NAME', b: ':name and :name_full' })
    expect(t.get('c', { name: 'ada' })).toBe('ada / Ada / ADA')
    // The longer placeholder is not clipped by the shorter one.
    expect(t.get('b', { name: 'ada', name_full: 'Ada Lovelace' })).toBe('ada and Ada Lovelace')
  })

  test('an unknown placeholder is left alone', () => {
    const t = new Translator({ locale: 'en' })
    t.addLines('en', { l: ':known and :unknown' })
    expect(t.get('l', { known: 'yes' })).toBe('yes and :unknown')
  })
})

/**
 * Regression: the `group` branch of `addLines` spread one level only, so an
 * override of `{ 404: { title: 'X' } }` DELETED the sibling keys under `404`.
 * Core ships nested-per-status `errors` lines and tells apps to override them
 * via `lang/vendor/core/<locale>/errors.ts`.
 */
describe('addLines deep-merges group lines', () => {
  test('a nested override layers on top instead of replacing the branch', () => {
    const t = new Translator({ locale: 'en' })
    t.addLines('en', { 404: { title: 'Not Found', message: 'Nothing here.' } }, 'errors')
    t.addLines('en', { 404: { title: 'Gone Fishing' } }, 'errors')

    expect(t.get('errors.404.title')).toBe('Gone Fishing')
    expect(t.get('errors.404.message')).toBe('Nothing here.')
  })

  test('the same holds for namespaced (vendor-override) lines', () => {
    const t = new Translator({ locale: 'en' })
    t.addLines('en', { 500: { title: 'Server Error', message: 'Try later.' } }, 'errors', 'core')
    t.addLines('en', { 500: { title: 'Oops' } }, 'errors', 'core')

    expect(t.get('core::errors.500.title')).toBe('Oops')
    expect(t.get('core::errors.500.message')).toBe('Try later.')
  })
})
