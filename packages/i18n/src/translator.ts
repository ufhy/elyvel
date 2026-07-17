import { selectPluralSegment } from './pluralize'

export type Replacements = Record<string, string | number>

export interface TranslatorOptions {
  /** Active locale (default `en`). */
  locale?: string
  /** Locale used when a key is missing in the active one (default = `locale`). */
  fallback?: string
}

/** A nested tree of translation lines: `{ messages: { welcome: 'Hi :name' } }`. */
export type LinesTree = Record<string, unknown>

/**
 * Resolves translation keys to strings, with `:placeholder` replacement and
 * pluralization. Lines are stored per-locale as nested trees and looked up by
 * dot-path (`messages.welcome`). Mirrors Laravel's `Translator`.
 */
export class Translator {
  private locale: string
  private fallback: string
  private readonly locales = new Map<string, LinesTree>()

  constructor(options: TranslatorOptions = {}) {
    this.locale = options.locale ?? 'en'
    this.fallback = options.fallback ?? this.locale
  }

  setLocale(locale: string): this {
    this.locale = locale
    return this
  }

  getLocale(): string {
    return this.locale
  }

  setFallback(locale: string): this {
    this.fallback = locale
    return this
  }

  getFallback(): string {
    return this.fallback
  }

  /** Merge a tree of lines into a locale (optionally under a `group` prefix). */
  addLines(locale: string, lines: LinesTree, group?: string): this {
    const existing = this.locales.get(locale) ?? {}
    const merged = group ? { ...existing, [group]: { ...(existing[group] as object), ...lines } } : deepMerge(existing, lines)
    this.locales.set(locale, merged)
    return this
  }

  /**
   * Load lines from a `lang/` directory:
   *   lang/en/messages.ts   → keys under `messages.*`
   *   lang/en.ts            → top-level keys (whole-sentence translations)
   * Each file default-exports a plain (optionally nested) object.
   */
  async load(dir: string): Promise<this> {
    const glob = new Bun.Glob('**/*.{ts,js}')
    for await (const rel of glob.scan({ cwd: dir, onlyFiles: true })) {
      if (rel.endsWith('.d.ts'))
        continue
      const mod = (await import(`${dir}/${rel}`)) as { default?: LinesTree }
      if (!mod.default)
        continue
      const parts = rel.replace(/\.(ts|js)$/, '').split('/')
      const locale = parts[0]!
      const group = parts.slice(1).join('.') // '' for lang/<locale>.ts
      this.addLines(locale, mod.default, group || undefined)
    }
    return this
  }

  /** Whether `key` resolves in `locale` (or the active locale). */
  has(key: string, locale?: string): boolean {
    return resolve(this.locales.get(locale ?? this.locale), key) !== undefined
  }

  /**
   * Translate `key`, replacing `:placeholder` tokens. Falls back to the fallback
   * locale, then returns the key itself when nothing matches (Laravel's behavior).
   */
  get(key: string, replace: Replacements = {}, locale?: string): string {
    const active = locale ?? this.locale
    const line
      = resolve(this.locales.get(active), key)
        ?? resolve(this.locales.get(this.fallback), key)
    if (typeof line !== 'string')
      return key
    return applyReplacements(line, replace)
  }

  /**
   * Translate with pluralization: picks the segment matching `number`, sets the
   * `:count` placeholder, and applies the rest of `replace`.
   */
  choice(key: string, number: number, replace: Replacements = {}, locale?: string): string {
    const active = locale ?? this.locale
    const line
      = resolve(this.locales.get(active), key)
        ?? resolve(this.locales.get(this.fallback), key)
    if (typeof line !== 'string')
      return key
    const segment = selectPluralSegment(line, number)
    return applyReplacements(segment, { count: number, ...replace })
  }
}

/** Resolve a dot-path within a nested tree; undefined if any segment is missing. */
function resolve(tree: LinesTree | undefined, key: string): unknown {
  if (!tree)
    return undefined
  return key.split('.').reduce<unknown>(
    (node, part) => (node != null && typeof node === 'object'
      ? (node as Record<string, unknown>)[part]
      : undefined),
    tree,
  )
}

/** Replace `:name` tokens; `:Name`/`:NAME` mirror the placeholder's casing. */
function applyReplacements(line: string, replace: Replacements): string {
  let result = line
  for (const [key, raw] of Object.entries(replace)) {
    const value = String(raw)
    result = result
      .replace(new RegExp(`:${escapeRegExp(key)}\\b`, 'g'), value)
      .replace(new RegExp(`:${escapeRegExp(capitalize(key))}\\b`, 'g'), capitalize(value))
      .replace(new RegExp(`:${escapeRegExp(key.toUpperCase())}\\b`, 'g'), value.toUpperCase())
  }
  return result
}

function deepMerge(a: LinesTree, b: LinesTree): LinesTree {
  const out: LinesTree = { ...a }
  for (const [key, value] of Object.entries(b)) {
    const prev = out[key]
    out[key]
      = prev && typeof prev === 'object' && value && typeof value === 'object' && !Array.isArray(value)
        ? deepMerge(prev as LinesTree, value as LinesTree)
        : value
  }
  return out
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
