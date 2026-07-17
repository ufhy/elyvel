/**
 * Localization for elysia-ravel. Use the global {@link __}/{@link trans} helpers
 * backed by a default {@link Translator}, or construct your own instance.
 *
 * @example
 * import { __, loadTranslations, setLocale } from '@elysia-ravel/i18n'
 * await loadTranslations('./lang')     // lang/en/messages.ts, lang/id/messages.ts, …
 * setLocale('id')
 * __('messages.welcome', { name: 'Ada' })          // "Selamat datang, Ada"
 * transChoice('messages.apples', 3, { count: 3 })  // ":count apples" → "3 apples"
 */
import type { Replacements, TranslatorOptions } from './translator'
import { Translator } from './translator'

export { selectPluralSegment } from './pluralize'
export {
  type LinesTree,
  type Replacements,
  Translator,
  type TranslatorOptions,
} from './translator'

let translator = new Translator()

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

/** The default translator's active locale. */
export function getLocale(): string {
  return translator.getLocale()
}

/** Translate a key with `:placeholder` replacement (Laravel's `__`). */
export function __(key: string, replace?: Replacements, locale?: string): string {
  return translator.get(key, replace, locale)
}

/** Alias of {@link __}. */
export function trans(key: string, replace?: Replacements, locale?: string): string {
  return translator.get(key, replace, locale)
}

/** Translate with pluralization based on `number` (Laravel's `trans_choice`). */
export function transChoice(
  key: string,
  number: number,
  replace?: Replacements,
  locale?: string,
): string {
  return translator.choice(key, number, replace, locale)
}
