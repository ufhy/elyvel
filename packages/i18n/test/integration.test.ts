import { createApp } from '@elyvel/core'
import { setMessageTranslator, trans as supportTrans } from '@elyvel/support'
import { afterAll, describe, expect, test } from 'bun:test'
import { __, getLocale, getTranslator, I18nServiceProvider, runWithLocale } from '../src/index'

const basePath = new URL('./appfix', import.meta.url).pathname
const namespaceBasePath = new URL('./appfix-namespaces', import.meta.url).pathname

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
    // A generic example key, deliberately NOT `validation.*` (that's the real
    // @elyvel/validation package's own namespaced `validation::*` keys now —
    // see the "auto-loads installed packages'" describe block below) — this
    // test is only about the generic support-seam mechanism itself.
    const t = getTranslator()
    t.addLines('en', { required: 'The :attribute field is required.' }, 'demo')
    setMessageTranslator((key, replace) =>
      t.has(key) ? t.get(key, replace) : undefined)
    // known key → translated; unknown key → English fallback survives
    expect(supportTrans('demo.required', { attribute: 'email' }, 'x')).toBe('The email field is required.')
    expect(supportTrans('demo.nope', {}, 'fallback text')).toBe('fallback text')
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

  test('setRequestLocale() called after an await in one hook is seen by a later hook/handler', async () => {
    const app = await createApp({ basePath, providers: [I18nServiceProvider] })
    const msg = async (locale: string) =>
      (await app.handle(new Request(`http://localhost/async-locale?locale=${locale}`))
        .then(r => r.json()) as { msg: string }).msg

    expect(await msg('id')).toBe('Halo Ada')
    expect(await msg('en')).toBe('Hello Ada')
  })

  test('concurrent requests setting different locales this way do not leak into each other', async () => {
    const app = await createApp({ basePath, providers: [I18nServiceProvider] })
    const msg = async (locale: string) =>
      (await app.handle(new Request(`http://localhost/async-locale?locale=${locale}`))
        .then(r => r.json()) as { msg: string }).msg

    const [id, en] = await Promise.all([msg('id'), msg('en')])
    expect(id).toBe('Halo Ada')
    expect(en).toBe('Hello Ada')
  })
})

describe('I18nServiceProvider auto-loads installed packages\' own lang/ (namespaced)', () => {
  test('a package under node_modules/@elyvel/* with its own lang/ becomes `pkg::key`, overridable via lang/vendor/<pkg>/...', async () => {
    await createApp({ basePath: namespaceBasePath, providers: [I18nServiceProvider], autoloadRoutes: false })
    const t = getTranslator()
    // app's lang/vendor/fakepkg/en/messages.ts overrides this specific key
    expect(t.get('fakepkg::messages.hello')).toBe('Overridden by the app')
    // everything else still comes from the package's own bundled default
    expect(t.get('fakepkg::messages.untouched')).toBe('Still the package default')
  })
})
