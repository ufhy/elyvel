import type { Replacements } from './translator'
import { existsSync } from 'node:fs'
import { ServiceProvider } from '@elysia-ravel/core'
import { setMessageTranslator } from '@elysia-ravel/support'
import { __, currentLocale, getTranslator, setRequestLocale, trans, transChoice } from './index'

/** `config/i18n.ts` shape. */
export interface I18nConfig {
  /** Default locale (default `en`). */
  locale?: string
  /** Locale used when a key is missing in the active one (default = `locale`). */
  fallback?: string
  /** Directory of translation files, relative to the app root (default `lang`). */
  path?: string
  /** Whitelist of locales the request detector may switch to. Empty = allow any. */
  locales?: string[]
  /** Detect the request locale from query/session/cookie/header (default true). */
  detect?: boolean
  /** Session key holding a user's preferred locale (default `locale`). */
  sessionKey?: string
  /** Cookie name holding a persisted locale (default `locale`). */
  cookie?: string
  /** Log translation keys that fail to resolve (for finding untranslated strings). */
  logMissing?: boolean
}

/**
 * Wires localization into the app: configures the default translator from
 * `config('i18n')`, auto-loads `lang/`, routes framework messages through the
 * translator, detects each request's locale, and exposes `__`/`trans`/
 * `transChoice`/`locale` on the request context.
 *
 * Add it to `config/app.ts` providers.
 */
export class I18nServiceProvider extends ServiceProvider {
  override async register(): Promise<void> {
    const cfg = this.app.config.get<I18nConfig | undefined>('i18n') ?? {}
    const translator = getTranslator()
    translator.setLocale(cfg.locale ?? 'en')
    translator.setFallback(cfg.fallback ?? cfg.locale ?? 'en')

    const dir = this.app.path(cfg.path ?? 'lang')
    if (existsSync(dir))
      await translator.load(dir)

    // Report unresolved keys (opt-in) so untranslated strings surface in logs.
    if (cfg.logMissing) {
      const log = this.app.logger.child('i18n')
      translator.handleMissing((key, locale) => log.warn('missing translation', { key, locale }))
    }

    // Route @elysia-ravel/support's `trans()` (validation/errors) through the real
    // translator, honoring the per-request locale. Missing keys return undefined
    // so the caller's English fallback is used.
    setMessageTranslator((key, replace) =>
      translator.has(key, currentLocale()) || translator.has(key, translator.getFallback())
        ? translator.get(key, replace, currentLocale())
        : undefined)
  }

  override boot(): void {
    const cfg = this.app.config.get<I18nConfig | undefined>('i18n') ?? {}
    const allowed = cfg.locales
    const sessionKey = cfg.sessionKey ?? 'locale'
    const cookieName = cfg.cookie ?? 'locale'
    const detect = cfg.detect !== false

    // A global derive: it runs after the session derive (so `session` is available),
    // resolves the request locale, and exposes the translation helpers on context.
    this.app.elysia.derive({ as: 'global' }, (ctx: any) => {
      if (detect) {
        const locale = detectLocale(ctx.request, ctx.session, { allowed, sessionKey, cookieName })
        if (locale)
          setRequestLocale(locale)
      }
      return {
        locale: currentLocale(),
        __: (key: string, replace?: Replacements) => __(key, replace),
        trans: (key: string, replace?: Replacements) => trans(key, replace),
        transChoice: (key: string, n: number, replace?: Replacements) => transChoice(key, n, replace),
      }
    })
  }
}

/** Identity helper for a typed `config/i18n.ts`. */
export function defineI18nConfig(config: I18nConfig): I18nConfig {
  return config
}

export interface DetectOptions {
  allowed?: string[]
  sessionKey: string
  cookieName: string
}

/**
 * Resolve the request locale, most-explicit first:
 * `?lang`/`?locale` → session preference → `locale` cookie → `Accept-Language`.
 */
export function detectLocale(
  request: Request,
  session: { get?(key: string): unknown } | undefined,
  { allowed, sessionKey, cookieName }: DetectOptions,
): string | undefined {
  const ok = (locale: string | undefined | null): string | undefined =>
    locale && (!allowed?.length || allowed.includes(locale)) ? locale : undefined

  const url = new URL(request.url)
  const fromQuery = ok(url.searchParams.get('lang') ?? url.searchParams.get('locale'))
  if (fromQuery)
    return fromQuery

  const fromSession = ok(session?.get?.(sessionKey) as string | undefined)
  if (fromSession)
    return fromSession

  const fromCookie = ok(readCookie(request.headers.get('cookie'), cookieName))
  if (fromCookie)
    return fromCookie

  const header = request.headers.get('accept-language')
  if (header) {
    for (const part of header.split(',')) {
      const tag = part.split(';')[0]?.trim()
      const primary = ok(tag) ?? ok(tag?.split('-')[0])
      if (primary)
        return primary
    }
  }
  return undefined
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header)
    return undefined
  for (const part of header.split(';')) {
    const [key, value] = part.trim().split('=')
    if (key === name)
      return value ? decodeURIComponent(value) : undefined
  }
  return undefined
}
