import { describe, expect, test } from 'bun:test'
import { currentLocale, runWithLocale } from '../src/index'

/**
 * Regression: the i18n provider's `derive` returned `locale: currentLocale()`,
 * evaluating it at derive time. `derive` runs BEFORE `beforeHandle` — the
 * documented place to call `setRequestLocale()` — so `ctx.locale` froze at the
 * configured default while `ctx.__()` returned the request's actual locale,
 * desyncing `<html lang>` and date formatting from the translations on the page.
 * It is now a getter.
 */
describe('the derived locale reflects a later setRequestLocale', () => {
  test('a getter sees the change; a snapshot does not', async () => {
    // Exactly the two shapes: what the provider builds now, and what it built.
    const derived = {
      get locale() {
        return currentLocale()
      },
    }

    await runWithLocale('en', async () => {
      const snapshot = { locale: currentLocale() }
      expect(derived.locale).toBe('en')

      // Stands in for a `beforeHandle` switching the locale after `derive` ran.
      await runWithLocale('id', () => {
        expect(derived.locale).toBe('id') // fixed
        expect(snapshot.locale).toBe('en') // the old, broken behaviour
      })
    })
  })

  test('the provider exposes locale as a getter, not an own value', async () => {
    // Guards against a refactor quietly turning it back into a snapshot.
    const { I18nServiceProvider } = await import('../src/provider')
    const source = I18nServiceProvider.prototype.boot.toString()
    expect(source).toContain('get locale()')
  })
})
