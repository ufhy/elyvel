import type { Replacements, Translator } from './translator'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ServiceProvider } from '@elyvel/core'
import { setMessageTranslator } from '@elyvel/support'
import { __, currentLocale, getTranslator, registerLocaleRequestScope, trans, transChoice } from './index'

/** `config/i18n.ts` shape. */
export interface I18nConfig {
  /** Default locale (default `en`). */
  locale?: string
  /** Locale used when a key is missing in the active one (default = `locale`). */
  fallback?: string
  /** Directory of translation files, relative to the app root (default `lang`). */
  path?: string
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

    // Package-bundled translations FIRST (namespaced `package::key`) — so the
    // app's own lang/ dir, loaded next, can override specific lines via
    // `lang/vendor/<namespace>/...` (see Translator.load's `vendor/` handling)
    // without needing to redefine everything the package ships.
    await this.loadPackageNamespaces(translator)

    const dir = this.app.path(cfg.path ?? 'lang')
    if (existsSync(dir))
      await translator.load(dir)

    // Report unresolved keys (opt-in) so untranslated strings surface in logs.
    if (cfg.logMissing) {
      const log = this.app.logger.child('i18n')
      translator.handleMissing((key, locale) => log.warn('missing translation', { key, locale }))
    }

    // Route @elyvel/support's `trans()` (validation/errors) through the real
    // translator, honoring the per-request locale. Missing keys return undefined
    // so the caller's English fallback is used.
    setMessageTranslator((key, replace) =>
      translator.has(key, currentLocale()) || translator.has(key, translator.getFallback())
        ? translator.get(key, replace, currentLocale())
        : undefined)
  }

  /**
   * Loads every installed `@elyvel/*` package's own `lang/` directory (if it
   * ships one) into its own namespace — `node_modules/@elyvel/<name>/lang`
   * becomes `trans('<name>::...')`. Mirrors `elyvel package:discover`'s
   * `node_modules` scan, but for translations instead of providers: no
   * package.json metadata, just a well-known directory convention.
   */
  private async loadPackageNamespaces(translator: Translator): Promise<void> {
    const scopeDir = this.app.path('node_modules', '@elyvel')
    if (!existsSync(scopeDir))
      return
    for (const entry of readdirSync(scopeDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink())
        continue
      const langDir = join(scopeDir, entry.name, 'lang')
      if (existsSync(langDir))
        await translator.loadNamespace(entry.name, langDir)
    }
  }

  override boot(): void {
    // Assigns each request an ambient reference `setRequestLocale()` attaches
    // its per-request locale to — must run before any hook that might call it.
    registerLocaleRequestScope(this.app.elysia)

    // Expose the translation helpers on the request context. No automatic locale
    // detection — the app sets the request locale (e.g. from a user preference)
    // via `setRequestLocale`; until then `currentLocale()` is the configured default.
    this.app.elysia.derive({ as: 'global' }, () => ({
      locale: currentLocale(),
      __: (key: string, replace?: Replacements) => __(key, replace),
      trans: (key: string, replace?: Replacements) => trans(key, replace),
      transChoice: (key: string, n: number, replace?: Replacements) => transChoice(key, n, replace),
    }))
  }
}

/** Identity helper for a typed `config/i18n.ts`. */
export function defineI18nConfig(config: I18nConfig): I18nConfig {
  return config
}
