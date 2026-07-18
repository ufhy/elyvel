import { setMessageTranslator } from '@elysia-ravel/support'
import { afterEach, describe, expect, test } from 'bun:test'
import { formatMessage } from '../src/messages'

// Simulate what @elysia-ravel/i18n's provider does: register a translator that
// serves Indonesian messages. formatMessage should route through it, with the
// English default surviving for any key the translator doesn't know.
const id: Record<string, string> = {
  'validation.required': 'Kolom :attribute wajib diisi.',
  'validation.min.string': 'Kolom :attribute minimal :min karakter.',
  'validation.attributes.email': 'surel',
}

afterEach(() => setMessageTranslator(null))

describe('validation message translation (via support seam)', () => {
  test('uses the translated template when a translator is registered', () => {
    setMessageTranslator((key, replace, fallback) => id[key] ?? fallback)
    expect(formatMessage({ rule: 'required', attribute: 'name', args: [], sizeKind: 'string' }))
      .toBe('Kolom name wajib diisi.')
  })

  test('translates size-variant keys (validation.<rule>.<sizeKind>)', () => {
    setMessageTranslator((key, replace, fallback) => id[key] ?? fallback)
    expect(formatMessage({ rule: 'min', attribute: 'password', args: ['8'], sizeKind: 'string' }))
      .toBe('Kolom password minimal 8 karakter.')
  })

  test('localizes the attribute display name (validation.attributes.*)', () => {
    setMessageTranslator((key, replace, fallback) => id[key] ?? fallback)
    expect(formatMessage({ rule: 'required', attribute: 'email', args: [], sizeKind: 'string' }))
      .toBe('Kolom surel wajib diisi.')
  })

  test('falls back to the English default for unknown keys', () => {
    setMessageTranslator((key, replace, fallback) => id[key] ?? fallback)
    expect(formatMessage({ rule: 'email', attribute: 'email', args: [], sizeKind: 'string' }))
      .toBe('The surel field must be a valid email address.')
  })

  test('no translator → built-in English (no regression)', () => {
    expect(formatMessage({ rule: 'required', attribute: 'name', args: [], sizeKind: 'string' }))
      .toBe('The name field is required.')
  })
})
