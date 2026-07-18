import { createApp } from '@elysia-ravel/core'
import { setMessageTranslator, trans as supportTrans } from '@elysia-ravel/support'
import { afterAll, describe, expect, test } from 'bun:test'
import { __, getLocale, getTranslator, I18nServiceProvider, runWithLocale } from '../src/index'

const basePath = new URL('./appfix', import.meta.url).pathname

describe('per-request locale (AsyncLocalStorage)', () => {
  const t = getTranslator()
  t.setLocale('en').setFallback('en')
  t.addLines('en', { hi: 'Hello :name' }, 'm')
  t.addLines('id', { hi: 'Halo :name' }, 'm')

  test('runWithLocale scopes the locale; default restored outside', () => {
    expect(runWithLocale('id', () => __('m.hi', { name: 'A' }))).toBe('Halo A')
    expect(__('m.hi', { name: 'A' })).toBe('Hello A')
  })

  test('concurrent scopes do not leak into each other', async () => {
    const slow = (locale: string, ms: number) =>
      runWithLocale(locale, async () => {
        await new Promise(r => setTimeout(r, ms))
        return getLocale()
      })
    const [id, en] = await Promise.all([slow('id', 20), slow('en', 5)])
    expect(id).toBe('id')
    expect(en).toBe('en')
  })
})

describe('support trans() seam bridge', () => {
  afterAll(() => setMessageTranslator(null))

  test('framework messages translate once a translator is registered', () => {
    const t = getTranslator()
    t.addLines('en', { required: 'The :attribute field is required.' }, 'validation')
    setMessageTranslator((key, replace) =>
      t.has(key) ? t.get(key, replace) : undefined)
    // known key → translated; unknown key → English fallback survives
    expect(supportTrans('validation.required', { attribute: 'email' }, 'x')).toBe('The email field is required.')
    expect(supportTrans('validation.nope', {}, 'fallback text')).toBe('fallback text')
  })
})

describe('I18nServiceProvider (boot)', () => {
  test('serves the configured default locale (no auto-detection)', async () => {
    const app = await createApp({ basePath, providers: [I18nServiceProvider] })
    const msg = async (init?: RequestInit) =>
      (await app.handle(new Request('http://localhost/hi', init)).then(r => r.json()) as { msg: string }).msg

    expect(await msg()).toBe('Hello Ada') // default en
    // ?lang / Accept-Language no longer switch the locale — detection was removed.
    expect(await msg({ headers: { 'accept-language': 'id' } } as RequestInit)).toBe('Hello Ada')
    expect((await app.handle(new Request('http://localhost/hi?lang=id')).then(r => r.json()) as { msg: string }).msg)
      .toBe('Hello Ada')
  })

  test('injects __ and locale into the request context (default locale)', async () => {
    const app = await createApp({ basePath, providers: [I18nServiceProvider] })
    const res = await app.handle(new Request('http://localhost/ctx'))
    const body = (await res.json()) as { locale: string, msg: string }
    expect(body.locale).toBe('en')
    expect(body.msg).toBe('Hello Ada')
  })
})
