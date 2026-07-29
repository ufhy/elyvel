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
 *
 * Namespaced keys (`package::file.key`, Laravel's package-translation syntax)
 * resolve against a SEPARATE tree per namespace — see {@link addLines}'s
 * `namespace` param and {@link loadNamespace} — so a package's own bundled
 * defaults never collide with the app's plain (unnamespaced) keys. An app
 * overriding a namespaced line loads its override into the SAME namespace
 * bucket (via `lang/vendor/<namespace>/...`, see `load`'s `vendor/` handling),
 * so the existing deep-merge naturally lets the app override just the keys it
 * cares about — the rest still resolve from the package's own defaults.
 */
export class Translator {
  private locale: string
  private fallback: string
  private readonly locales = new Map<string, LinesTree>()
  private readonly namespaces = new Map<string, Map<string, LinesTree>>()
  private onMissing?: (key: string, locale: string) => void

  constructor(options: TranslatorOptions = {}) {
    this.locale = options.locale ?? 'en'
    this.fallback = options.fallback ?? this.locale
  }

  /** Register a callback fired whenever a key can't be resolved (for reporting). */
  handleMissing(fn: ((key: string, locale: string) => void) | undefined): this {
    this.onMissing = fn
    return this
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

  /**
   * Merge a tree of lines into a locale (optionally under a `group` prefix).
   * `namespace` routes into a package's own bucket (`package::key` lookups)
   * instead of the app's plain tree — used for package-bundled translations
   * and their `lang/vendor/<namespace>/...` overrides.
   */
  addLines(locale: string, lines: LinesTree, group?: string, namespace?: string): this {
    const store = namespace ? (this.namespaces.get(namespace) ?? new Map<string, LinesTree>()) : this.locales
    const existing = store.get(locale) ?? {}
    // Both branches DEEP-merge. The group branch used to spread one level only,
    // so an override supplying `{ 404: { title: 'X' } }` over a nested group
    // deleted the sibling keys under `404` (e.g. `message`) instead of layering
    // on top of them — exactly what `lang/vendor/<pkg>/...` overrides do, and
    // core's own `errors` lines are nested per status.
    const merged = group
      ? deepMerge(existing, { [group]: lines } as LinesTree)
      : deepMerge(existing, lines)
    store.set(locale, merged)
    if (namespace)
      this.namespaces.set(namespace, store)
    return this
  }

  /**
   * Load lines from a `lang/` directory:
   *   lang/en/messages.ts             → keys under `messages.*`
   *   lang/en.ts                      → top-level keys (whole-sentence translations)
   *   lang/vendor/<namespace>/en/messages.ts → OVERRIDES that namespace's `messages.*`
   *                                      (Laravel's `lang/vendor/{package}/{locale}/{file}`)
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
      if (parts[0] === 'vendor' && parts.length > 2) {
        const namespace = parts[1]!
        const locale = parts[2]!
        const group = parts.slice(3).join('.')
        this.addLines(locale, mod.default, group || undefined, namespace)
        continue
      }
      const locale = parts[0]!
      const group = parts.slice(1).join('.') // '' for lang/<locale>.ts
      this.addLines(locale, mod.default, group || undefined)
    }
    return this
  }

  /**
   * Load a package's own bundled translations under `namespace` — same
   * `lang/<locale>/<file>.ts` shape as {@link load}, just scoped to that
   * namespace's bucket instead of the app's plain tree.
   */
  async loadNamespace(namespace: string, dir: string): Promise<this> {
    const glob = new Bun.Glob('**/*.{ts,js}')
    for await (const rel of glob.scan({ cwd: dir, onlyFiles: true })) {
      if (rel.endsWith('.d.ts'))
        continue
      const mod = (await import(`${dir}/${rel}`)) as { default?: LinesTree }
      if (!mod.default)
        continue
      const parts = rel.replace(/\.(ts|js)$/, '').split('/')
      const locale = parts[0]!
      const group = parts.slice(1).join('.')
      this.addLines(locale, mod.default, group || undefined, namespace)
    }
    return this
  }

  /** Whether `key` resolves in `locale` (or the active locale). */
  has(key: string, locale?: string): boolean {
    return this.lookup(key, locale ?? this.locale) !== undefined
  }

  /**
   * Translate `key`, replacing `:placeholder` tokens. Falls back to the fallback
   * locale, then returns the key itself when nothing matches (Laravel's behavior).
   */
  get(key: string, replace: Replacements = {}, locale?: string): string {
    const active = locale ?? this.locale
    const line = this.lookup(key, active) ?? this.lookup(key, this.fallback)
    if (typeof line !== 'string') {
      this.onMissing?.(key, active)
      return key
    }
    return applyReplacements(line, replace)
  }

  /**
   * Translate with pluralization: picks the segment matching `number`, sets the
   * `:count` placeholder, and applies the rest of `replace`.
   */
  choice(key: string, number: number, replace: Replacements = {}, locale?: string): string {
    const active = locale ?? this.locale
    const line = this.lookup(key, active) ?? this.lookup(key, this.fallback)
    if (typeof line !== 'string') {
      this.onMissing?.(key, active)
      return key
    }
    const segment = selectPluralSegment(line, number, active)
    return applyReplacements(segment, { count: number, ...replace })
  }

  /** Resolves `key` against the right tree — namespaced (`pkg::rest`) or the app's plain tree. */
  private lookup(key: string, locale: string): unknown {
    const sep = key.indexOf('::')
    if (sep === -1)
      return resolve(this.locales.get(locale), key)
    const namespace = key.slice(0, sep)
    const rest = key.slice(sep + 2)
    return resolve(this.namespaces.get(namespace)?.get(locale), rest)
  }
}

/**
 * Resolve `key` against a tree: an exact top-level match first (Laravel's
 * "translation string as key" convention — `__('I love programming.')` — a
 * whole sentence used as its own key, which usually contains `.` and would
 * otherwise be misread as dot-notation nesting), then dot-path traversal
 * (`messages.welcome`) as a fallback.
 */
function resolve(tree: LinesTree | undefined, key: string): unknown {
  if (!tree)
    return undefined
  if (Object.hasOwn(tree, key))
    return tree[key]
  return key.split('.').reduce<unknown>(
    (node, part) => (node != null && typeof node === 'object'
      ? (node as Record<string, unknown>)[part]
      : undefined),
    tree,
  )
}

/** Replace `:name` tokens; `:Name`/`:NAME` mirror the placeholder's casing. */
function applyReplacements(line: string, replace: Replacements): string {
  const entries = Object.entries(replace)
  if (entries.length === 0)
    return line

  // Every accepted spelling of a placeholder → the text it expands to. Exact
  // keys are registered first so they always win over another key's case
  // variant.
  const lookup = new Map<string, string>()
  for (const [key, raw] of entries)
    lookup.set(key, String(raw))
  for (const [key, raw] of entries) {
    const value = String(raw)
    if (!lookup.has(capitalize(key)))
      lookup.set(capitalize(key), capitalize(value))
    if (!lookup.has(key.toUpperCase()))
      lookup.set(key.toUpperCase(), value.toUpperCase())
  }

  // Longest name first so `:name_full` is preferred over `:name`.
  const names = [...lookup.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp)
  const pattern = new RegExp(`:(${names.join('|')})\\b`, 'g')

  // ONE pass, with a FUNCTION replacer. The old per-key sequential
  // `.replace(re, value)` carried two bugs:
  //  - a string replacement leaves `$&`, `` $` ``, `$'` and `$1` ACTIVE inside
  //    the VALUE, so a user-supplied replacement of `$'` spliced in the text
  //    surrounding the placeholder.
  //  - each key's pass re-scanned text an earlier key had already substituted,
  //    so `{ name: ':secret', secret: 'p@ssw0rd' }` rendered the secret where
  //    the user's own name belonged — leaking `:token`/`:code`-style values to
  //    whoever controlled the other input.
  // A single pass with a function replacer is inert on both counts.
  return line.replace(pattern, (matched, name: string) => lookup.get(name) ?? matched)
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
