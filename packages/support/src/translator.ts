/**
 * A tiny translation seam so framework packages can emit translatable messages
 * without depending on `@elysia-ravel/i18n`. `support` has no dependencies and
 * everything depends on it, so this avoids a dependency cycle.
 *
 * By default `trans()` returns the provided English fallback (or the key), so
 * the framework works untranslated out of the box. When `@elysia-ravel/i18n` is
 * installed, its service provider calls {@link setMessageTranslator} to route
 * these calls through the real, locale-aware translator.
 */

export type Replacements = Record<string, string | number>

/** Resolve `key` to a string; must apply `:placeholder` replacements itself. */
export type MessageTranslator = (
  key: string,
  replace?: Replacements,
  fallback?: string,
) => string | undefined

let translator: MessageTranslator | null = null

/** Register the active translator (called by `@elysia-ravel/i18n`). */
export function setMessageTranslator(fn: MessageTranslator | null): void {
  translator = fn
}

/** Whether a translator has been registered. */
export function hasMessageTranslator(): boolean {
  return translator !== null
}

/** Apply `:name` replacements to a raw string (used for the untranslated fallback). */
function applyReplacements(line: string, replace: Replacements): string {
  let result = line
  for (const [key, raw] of Object.entries(replace)) {
    result = result.replace(new RegExp(`:${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), String(raw))
  }
  return result
}

/**
 * Translate `key`, falling back to `fallback` (with `:placeholder` replacement
 * applied) — then to the key — when no translator is registered or the key is
 * missing. Framework code passes the English string as `fallback` so nothing
 * regresses when i18n is absent.
 */
export function trans(key: string, replace: Replacements = {}, fallback?: string): string {
  const translated = translator?.(key, replace, fallback)
  if (translated !== undefined && translated !== key)
    return translated
  if (fallback !== undefined)
    return applyReplacements(fallback, replace)
  return key
}
