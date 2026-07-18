import { existsSync } from 'node:fs'
import { ServiceProvider } from '@elysia-ravel/core'
import { setMessageTranslator } from '@elysia-ravel/support'
import { currentLocale, getTranslator, setRequestLocale } from './index'

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
  /** Detect the request locale from `?lang`/`Accept-Language` (default true). */
  detect?: boolean
}

/**
 * Wires localization into the app: configures the default translator from
 * `config('i18n')`, auto-loads the `lang/` directory, routes framework messages
 * (validation, errors) through the translator, and detects each request's locale.
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

    // Route @elysia-ravel/support's `trans()` (used by validation/errors) through
    // the real translator, honoring the per-request locale. Missing keys return
    // undefined so the caller's English fallback is used.
    setMessageTranslator((key, replace, _fallback) => {
      return translator.has(key, currentLocale()) || translator.has(key, translator.getFallback())
        ? translator.get(key, replace, currentLocale())
        : undefined
    })
  }

  override boot(): void {
    const cfg = this.app.config.get<I18nConfig | undefined>('i18n') ?? {}
    if (cfg.detect === false)
      return
    const allowed = cfg.locales
    this.app.elysia.onRequest(({ request }) => {
      const detected = detectLocale(request, allowed)
      if (detected)
        setRequestLocale(detected)
    })
  }
}

/** Identity helper for a typed `config/i18n.ts`. */
export function defineI18nConfig(config: I18nConfig): I18nConfig {
  return config
}

/** Resolve the request locale: `?lang`/`?locale` query → `Accept-Language`. */
function detectLocale(request: Request, allowed?: string[]): string | undefined {
  const ok = (locale: string | undefined): string | undefined =>
    locale && (!allowed?.length || allowed.includes(locale)) ? locale : undefined

  const url = new URL(request.url)
  const fromQuery = ok(url.searchParams.get('lang') ?? url.searchParams.get('locale') ?? undefined)
  if (fromQuery)
    return fromQuery

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
