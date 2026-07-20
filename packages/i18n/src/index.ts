/**
 * Localization for elyvel. Use the global {@link __}/{@link trans} helpers
 * backed by a default {@link Translator}, or construct your own instance.
 *
 * @example
 * import { __, loadTranslations, setLocale } from '@elyvel/i18n'
 * await loadTranslations('./lang')     // lang/en/messages.ts, lang/id/messages.ts, …
 * setLocale('id')
 * __('messages.welcome', { name: 'Ada' })          // "Selamat datang, Ada"
 * transChoice('messages.apples', 3, { count: 3 })  // ":count apples" → "3 apples"
 */
import type { Replacements, TranslatorOptions } from './translator'
import { AsyncLocalStorage } from 'node:async_hooks'
import { Translator } from './translator'

export { selectPluralSegment } from './pluralize'
export { defineI18nConfig, type I18nConfig, I18nServiceProvider } from './provider'

let translator = new Translator()

// `runWithLocale()`'s explicit scoped override — `.run()` correctly wraps a
// single callback's entire continuation, no gotchas here (unlike enterWith(),
// see below).
const directLocaleStore = new AsyncLocalStorage<string>()

// Per-request locale, keyed by the Request object rather than stored directly
// in AsyncLocalStorage. Why: `setRequestLocale()` is typically called from an
// app's own locale-detection hook AFTER an `await` (e.g. a DB lookup for the
// user's saved preference) — and on Bun, `AsyncLocalStorage.enterWith()`
// called after an internal `await` does NOT propagate back to the code
// awaiting that hook (see [[bun-als-enterwith-gotcha]] — confirmed with a
// real Elysia request that silently kept the default locale). A WeakMap
// lookup has no continuation-tracking dependency, so it's safe to write from
// anywhere in the request's lifecycle. What DOES need to propagate via
// enterWith() is just the Request reference itself, set once, synchronously,
// at the very start of the request (see `registerLocaleRequestScope`) — a
// bare enterWith() with no prior await works fine on Bun.
const requestRefStore = new AsyncLocalStorage<Request>()
const localeByRequest = new WeakMap<Request, string>()

/** The locale in effect right now: an explicit `runWithLocale` override, else the request's, else the default. */
export function currentLocale(): string {
  const direct = directLocaleStore.getStore()
  if (direct)
    return direct
  const request = requestRefStore.getStore()
  const perRequest = request ? localeByRequest.get(request) : undefined
  return perRequest ?? translator.getLocale()
}

/** Run `fn` with `locale` active for its entire async continuation. */
export function runWithLocale<T>(locale: string, fn: () => T): T {
  return directLocaleStore.run(locale, fn)
}

/**
 * Set the locale for the rest of the current HTTP request — safe to call
 * from anywhere in the request's lifecycle, including after an `await` (e.g.
 * a DB/session lookup for the user's saved preference). Requires
 * `I18nServiceProvider` (or {@link registerLocaleRequestScope}) to be wired
 * so there's an active request to attach the locale to; throws otherwise —
 * outside a request (a queue job, a script), use {@link runWithLocale}.
 */
export function setRequestLocale(locale: string): void {
  const request = requestRefStore.getStore()
  if (!request) {
    throw new Error(
      '[elyvel] setRequestLocale() has no active HTTP request in scope (is I18nServiceProvider registered?). '
      + 'Outside a request, use runWithLocale(locale, fn) instead.',
    )
  }
  localeByRequest.set(request, locale)
}

/**
 * Wire per-request locale tracking into an Elysia instance — called once by
 * `I18nServiceProvider`. Assigns each incoming request an ambient reference
 * (synchronously, at the very start, so it propagates correctly on Bun) that
 * {@link setRequestLocale}/{@link currentLocale} key their per-request state on.
 */
export interface OnRequestCapable {
  onRequest(fn: (ctx: { request: Request }) => void): unknown
}

export function registerLocaleRequestScope(elysia: OnRequestCapable): void {
  elysia.onRequest(({ request }) => requestRefStore.enterWith(request))
}

/** The process-wide default translator (backs the global helpers). */
export function getTranslator(): Translator {
  return translator
}

/** Replace the default translator (e.g. with custom locale/fallback). */
export function setTranslator(instance: Translator): void {
  translator = instance
}

/** Configure the default translator's locale/fallback in place. */
export function configureTranslator(options: TranslatorOptions): Translator {
  if (options.locale)
    translator.setLocale(options.locale)
  if (options.fallback)
    translator.setFallback(options.fallback)
  return translator
}

/** Load a `lang/` directory into the default translator. */
export function loadTranslations(dir: string): Promise<Translator> {
  return translator.load(dir)
}

/** Set the default translator's active locale. */
export function setLocale(locale: string): void {
  translator.setLocale(locale)
}

/** The active locale (request scope's, else the default). */
export function getLocale(): string {
  return currentLocale()
}

/** Translate a key with `:placeholder` replacement (Laravel's `__`). */
export function __(key: string, replace?: Replacements, locale?: string): string {
  return translator.get(key, replace, locale ?? currentLocale())
}

/** Alias of {@link __}. */
export function trans(key: string, replace?: Replacements, locale?: string): string {
  return translator.get(key, replace, locale ?? currentLocale())
}

/** Translate with pluralization based on `number` (Laravel's `trans_choice`). */
export function transChoice(
  key: string,
  number: number,
  replace?: Replacements,
  locale?: string,
): string {
  return translator.choice(key, number, replace, locale ?? currentLocale())
}

export {
  type LinesTree,
  type Replacements,
  Translator,
  type TranslatorOptions,
} from './translator'
