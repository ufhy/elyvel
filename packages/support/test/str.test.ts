import { describe, expect, test } from 'bun:test'
import { Str } from '../src/str'

describe('Str', () => {
  test('case conversions', () => {
    expect(Str.studly('foo_bar baz')).toBe('FooBarBaz')
    expect(Str.camel('foo_bar')).toBe('fooBar')
    expect(Str.snake('fooBar')).toBe('foo_bar')
    expect(Str.kebab('fooBar')).toBe('foo-bar')
    expect(Str.title('hello world')).toBe('Hello World')
    expect(Str.ucfirst('hello')).toBe('Hello')
    expect(Str.lcfirst('Hello')).toBe('hello')
  })

  test('slug strips diacritics and non-alphanumerics', () => {
    expect(Str.slug('Hello World!')).toBe('hello-world')
    expect(Str.slug('Héllo Wörld')).toBe('hello-world')
    expect(Str.slug('a  b__c')).toBe('a-b-c')
    expect(Str.slug('Foo Bar', '_')).toBe('foo_bar')
  })

  test('limit / words truncate with a suffix', () => {
    expect(Str.limit('hello world', 5)).toBe('hello...')
    expect(Str.limit('hi', 5)).toBe('hi')
    expect(Str.words('a b c d', 2)).toBe('a b...')
  })

  test('before / after / between', () => {
    expect(Str.before('a@b.com', '@')).toBe('a')
    expect(Str.after('a@b.com', '@')).toBe('b.com')
    expect(Str.beforeLast('a.b.c', '.')).toBe('a.b')
    expect(Str.afterLast('a.b.c', '.')).toBe('c')
    expect(Str.between('[hi]', '[', ']')).toBe('hi')
    expect(Str.after('no-match', '@')).toBe('no-match')
  })

  test('contains / startsWith / endsWith accept arrays', () => {
    expect(Str.contains('hello', ['x', 'ell'])).toBe(true)
    expect(Str.contains('hello', 'z')).toBe(false)
    expect(Str.startsWith('hello', ['he', 'x'])).toBe(true)
    expect(Str.endsWith('hello', 'lo')).toBe(true)
    expect(Str.contains('hello', '')).toBe(false) // empty needle never matches
  })

  test('is() wildcard matching', () => {
    expect(Str.is('foo.*', 'foo.bar')).toBe(true)
    expect(Str.is('foo.*', 'baz.bar')).toBe(false)
    expect(Str.is(['a*', 'b*'], 'bravo')).toBe(true)
    expect(Str.is('exact', 'exact')).toBe(true)
  })

  test('start / finish avoid doubling', () => {
    expect(Str.start('path', '/')).toBe('/path')
    expect(Str.start('/path', '/')).toBe('/path')
    expect(Str.finish('dir', '/')).toBe('dir/')
    expect(Str.finish('dir/', '/')).toBe('dir/')
  })

  test('replaceFirst / replaceLast', () => {
    expect(Str.replaceFirst('a', 'X', 'a-a-a')).toBe('X-a-a')
    expect(Str.replaceLast('a', 'X', 'a-a-a')).toBe('a-a-X')
  })

  test('mask', () => {
    expect(Str.mask('taylor@example.com', '*', 3)).toBe('tay***************')
    expect(Str.mask('1234', '*', -2)).toBe('12**')
  })

  test('random is CSPRNG-backed and the right length; uuid is v4-shaped', () => {
    expect(Str.random(24)).toHaveLength(24)
    expect(Str.random(8)).not.toBe(Str.random(8))
    expect(Str.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
})
