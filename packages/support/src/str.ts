/**
 * String helpers mirroring Laravel's `Illuminate\Support\Str`. A focused,
 * high-value subset — the transforms apps actually reach for (case conversion,
 * slugs, truncation, substring slicing, wildcard matching, random/uuid). Word
 * inflection (`plural`/`singular`) is intentionally omitted — it needs a large
 * irregular-word ruleset; use a dedicated inflector if you need it.
 */

function splitWords(value: string): string[] {
  return value
    // camelCase / PascalCase → split on the case boundary
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export const Str = {
  /** URL-friendly slug: `"Hello World!"` → `"hello-world"`. */
  slug(value: string, separator = '-'): string {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036F]/g, '') // strip combining diacritical marks
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, separator)
      .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '')
  },

  /** `StudlyCase`: `"foo_bar"` → `"FooBar"`. */
  studly(value: string): string {
    return splitWords(value).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
  },

  /** `camelCase`: `"foo_bar"` → `"fooBar"`. */
  camel(value: string): string {
    return Str.lcfirst(Str.studly(value))
  },

  /** `snake_case`: `"fooBar"` → `"foo_bar"` (or a custom delimiter). */
  snake(value: string, delimiter = '_'): string {
    return splitWords(value).map(w => w.toLowerCase()).join(delimiter)
  },

  /** `kebab-case`: `"fooBar"` → `"foo-bar"`. */
  kebab(value: string): string {
    return Str.snake(value, '-')
  },

  /** `Title Case`: each word capitalized. */
  title(value: string): string {
    return splitWords(value).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
  },

  /** `Headline`: like title but preserves acronyms/word boundaries from any casing. */
  headline(value: string): string {
    return Str.title(value)
  },

  upper: (value: string): string => value.toUpperCase(),
  lower: (value: string): string => value.toLowerCase(),
  ucfirst: (value: string): string => value.charAt(0).toUpperCase() + value.slice(1),
  lcfirst: (value: string): string => value.charAt(0).toLowerCase() + value.slice(1),

  /** Truncate to `limit` chars, appending `end` if it was cut. */
  limit(value: string, limit = 100, end = '...'): string {
    return value.length <= limit ? value : value.slice(0, limit).trimEnd() + end
  },

  /** Truncate to `words` words, appending `end` if cut. */
  words(value: string, words = 100, end = '...'): string {
    const parts = value.split(/\s+/)
    return parts.length <= words ? value : parts.slice(0, words).join(' ') + end
  },

  /** Everything before the first occurrence of `search` (whole string if absent). */
  before(value: string, search: string): string {
    if (search === '')
      return value
    const i = value.indexOf(search)
    return i === -1 ? value : value.slice(0, i)
  },

  /** Everything before the last occurrence of `search`. */
  beforeLast(value: string, search: string): string {
    if (search === '')
      return value
    const i = value.lastIndexOf(search)
    return i === -1 ? value : value.slice(0, i)
  },

  /** Everything after the first occurrence of `search` (whole string if absent). */
  after(value: string, search: string): string {
    if (search === '')
      return value
    const i = value.indexOf(search)
    return i === -1 ? value : value.slice(i + search.length)
  },

  /** Everything after the last occurrence of `search`. */
  afterLast(value: string, search: string): string {
    if (search === '')
      return value
    const i = value.lastIndexOf(search)
    return i === -1 ? value : value.slice(i + search.length)
  },

  /** The substring between the first `from` and the last `to`. */
  between(value: string, from: string, to: string): string {
    if (from === '' || to === '')
      return value
    return Str.beforeLast(Str.after(value, from), to)
  },

  contains(haystack: string, needles: string | string[]): boolean {
    return (Array.isArray(needles) ? needles : [needles]).some(n => n !== '' && haystack.includes(n))
  },

  containsAll(haystack: string, needles: string[]): boolean {
    return needles.every(n => haystack.includes(n))
  },

  startsWith(haystack: string, needles: string | string[]): boolean {
    return (Array.isArray(needles) ? needles : [needles]).some(n => haystack.startsWith(n))
  },

  endsWith(haystack: string, needles: string | string[]): boolean {
    return (Array.isArray(needles) ? needles : [needles]).some(n => n !== '' && haystack.endsWith(n))
  },

  /** Wildcard match where `*` matches any run of characters (Laravel's `Str::is`). */
  is(pattern: string | string[], value: string): boolean {
    return (Array.isArray(pattern) ? pattern : [pattern]).some((p) => {
      if (p === value)
        return true
      const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
      return new RegExp(`^${escaped}$`).test(value)
    })
  },

  /** Prepend `prefix` unless already present (no double prefix). */
  start(value: string, prefix: string): string {
    return value.startsWith(prefix) ? value : prefix + value
  },

  /** Append a single `cap` unless already there. */
  finish(value: string, cap: string): string {
    return value.endsWith(cap) ? value : value + cap
  },

  replaceFirst(search: string, replace: string, subject: string): string {
    if (search === '')
      return subject
    const i = subject.indexOf(search)
    return i === -1 ? subject : subject.slice(0, i) + replace + subject.slice(i + search.length)
  },

  replaceLast(search: string, replace: string, subject: string): string {
    if (search === '')
      return subject
    const i = subject.lastIndexOf(search)
    return i === -1 ? subject : subject.slice(0, i) + replace + subject.slice(i + search.length)
  },

  /** Mask a portion with `char`, starting at `index` for `length` chars (negative index counts from the end). */
  mask(value: string, char: string, index: number, length?: number): string {
    if (char === '')
      return value
    const start = index < 0 ? Math.max(0, value.length + index) : index
    const end = length === undefined ? value.length : start + length
    return value.slice(0, start) + char[0]!.repeat(Math.max(0, Math.min(end, value.length) - start)) + value.slice(end)
  },

  padLeft: (value: string, length: number, pad = ' '): string => value.padStart(length, pad),
  padRight: (value: string, length: number, pad = ' '): string => value.padEnd(length, pad),

  repeat: (value: string, times: number): string => value.repeat(times),
  reverse: (value: string): string => [...value].reverse().join(''),
  length: (value: string): number => value.length,
  wordCount: (value: string): number => value.trim() === '' ? 0 : value.trim().split(/\s+/).length,

  /** A random alphanumeric string of `length` chars (CSPRNG). */
  random(length = 16): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    const bytes = crypto.getRandomValues(new Uint8Array(length))
    let out = ''
    for (let i = 0; i < length; i++) out += alphabet[bytes[i]! % alphabet.length]
    return out
  },

  /** A random RFC-4122 v4 UUID. */
  uuid: (): string => crypto.randomUUID(),
}
