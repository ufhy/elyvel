import { describe, expect, test } from 'bun:test'
import { selectPluralSegment, Translator } from '../src/index'

function make() {
  const t = new Translator({ locale: 'en', fallback: 'en' })
  t.addLines('en', {
    welcome: 'Welcome, :name',
    greeting: 'Hello :Name',
    apples: '{0} No apples|[1,19] :count apple(s)|[20,*] Many apples',
    items: 'item|items',
  }, 'messages')
  t.addLines('id', { welcome: 'Selamat datang, :name' }, 'messages')
  return t
}

describe('Translator.get', () => {
  test('resolves a dot-path key and replaces :placeholder', () => {
    expect(make().get('messages.welcome', { name: 'Ada' })).toBe('Welcome, Ada')
  })

  test(':Name mirrors the placeholder casing', () => {
    expect(make().get('messages.greeting', { name: 'ada' })).toBe('Hello Ada')
  })

  test('missing key returns the key itself', () => {
    expect(make().get('messages.nope')).toBe('messages.nope')
  })

  test('falls back to the fallback locale', () => {
    const t = make().setLocale('id').setFallback('en')
    expect(t.get('messages.welcome', { name: 'Budi' })).toBe('Selamat datang, Budi') // id has it
    expect(t.get('messages.greeting', { name: 'x' })).toBe('Hello X') // only en has it → fallback
  })

  test('setLocale switches the active locale', () => {
    const t = make()
    expect(t.getLocale()).toBe('en')
    t.setLocale('id')
    expect(t.get('messages.welcome', { name: 'Sri' })).toBe('Selamat datang, Sri')
  })
})

describe('Translator.choice', () => {
  test('standard plural: 1 vs many', () => {
    const t = make()
    expect(t.choice('messages.items', 1)).toBe('item')
    expect(t.choice('messages.items', 3)).toBe('items')
  })

  test('explicit ranges: {0}, [1,19], [20,*] with :count', () => {
    const t = make()
    expect(t.choice('messages.apples', 0)).toBe('No apples')
    expect(t.choice('messages.apples', 5)).toBe('5 apple(s)')
    expect(t.choice('messages.apples', 50)).toBe('Many apples')
  })
})

describe('selectPluralSegment (unit)', () => {
  test('picks by explicit range then falls back to standard rules', () => {
    expect(selectPluralSegment('one|many', 1)).toBe('one')
    expect(selectPluralSegment('one|many', 9)).toBe('many')
    expect(selectPluralSegment('{0} zero|[1,*] some', 0)).toBe('zero')
    expect(selectPluralSegment('{0} zero|[1,*] some', 4)).toBe('some')
  })
})

describe('Translator.load', () => {
  test('loads lang/<locale>/<group>.ts and lang/<locale>.ts', async () => {
    const dir = new URL('./fixtures/lang', import.meta.url).pathname
    const t = new Translator({ locale: 'en', fallback: 'en' })
    await t.load(dir)
    expect(t.get('messages.welcome', { name: 'Grace' })).toBe('Welcome, Grace')
    expect(t.get('messages.welcome', { name: 'Grace' }, 'id')).toBe('Selamat datang, Grace')
    // whole-sentence key from lang/en.ts (no group)
    expect(t.get('Full sentence key', { thing: 'x' })).toBe('A whole sentence, x')
  })
})
