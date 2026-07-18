import { describe, expect, test } from 'bun:test'
import { Translator } from '../src/translator'

describe('CLDR pluralization', () => {
  test('English: one|other by locale rules', () => {
    const t = new Translator({ locale: 'en' })
    t.addLines('en', { apples: 'apple|apples' }, 'm')
    expect(t.choice('m.apples', 1)).toBe('apple')
    expect(t.choice('m.apples', 5)).toBe('apples')
  })

  test('Russian: one|few|many maps to CLDR categories', () => {
    const t = new Translator({ locale: 'ru' })
    // ru categories in canonical order: one, few, many, other
    t.addLines('ru', { items: 'товар|товара|товаров|товара' }, 'm')
    expect(t.choice('m.items', 1)).toBe('товар') // one
    expect(t.choice('m.items', 2)).toBe('товара') // few
    expect(t.choice('m.items', 5)).toBe('товаров') // many
  })

  test('Indonesian: no plural distinction → single form', () => {
    const t = new Translator({ locale: 'id' })
    t.addLines('id', { items: ':count barang' }, 'm')
    expect(t.choice('m.items', 1)).toBe('1 barang')
    expect(t.choice('m.items', 9)).toBe('9 barang')
  })

  test('explicit ranges still win over CLDR', () => {
    const t = new Translator({ locale: 'en' })
    t.addLines('en', { a: '{0} none|[1,*] some' }, 'm')
    expect(t.choice('m.a', 0)).toBe('none')
    expect(t.choice('m.a', 3)).toBe('some')
  })
})

describe('missing-key reporting', () => {
  test('handleMissing fires for unresolved keys', () => {
    const missed: string[] = []
    const t = new Translator({ locale: 'en' })
    t.handleMissing(key => missed.push(key))
    t.get('nope.here')
    t.addLines('en', { hi: 'Hello' }, 'm')
    t.get('m.hi') // resolves → no report
    expect(missed).toEqual(['nope.here'])
  })
})
