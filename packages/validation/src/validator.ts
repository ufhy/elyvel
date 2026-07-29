import type { SizeKind } from './messages'
import type { ErrorBag } from './validation-exception'
import { formatMessage } from './messages'
import { getValue, hasPath, isEmpty, RULES } from './rules'
import { ValidationException } from './validation-exception'

export type Data = Record<string, unknown>

export type FailFn = (message: string) => void
export interface CustomRuleContext {
  attribute: string
  data: Data
}
/** A closure rule, à la Laravel: `(value, fail, ctx) => void`. */
export type ClosureRule = (
  value: unknown,
  fail: FailFn,
  ctx: CustomRuleContext,
) => void | Promise<void>
/** A rule object with a `validate(value, fail, ctx)` method. */
export interface RuleObject {
  validate(value: unknown, fail: FailFn, ctx: CustomRuleContext): void | Promise<void>
}
export type RuleEntry = string | ClosureRule | RuleObject

/** Rules per field: a piped string, or an array mixing strings + custom rules. */
export type Rules = Record<string, string | RuleEntry[]>

export interface ValidatorOptions {
  messages?: Record<string, string>
  attributes?: Record<string, string>
}

interface ParsedRule {
  name: string
  args: string[]
}

// ── path helpers (dot + wildcard `*`) ───────────────────────────────────────
/** Expand a rule key with `*` into concrete paths present in the data. */
function expandKey(key: string, data: Data): string[] {
  if (!key.includes('*'))
    return [key]
  let paths = ['']
  for (const seg of key.split('.')) {
    const next: string[] = []
    for (const prefix of paths) {
      if (seg === '*') {
        const target = getValue(data, prefix)
        if (Array.isArray(target)) {
          target.forEach((_, i) => {
            next.push(prefix ? `${prefix}.${i}` : String(i))
          })
        }
        else if (target && typeof target === 'object') {
          for (const k of Object.keys(target)) next.push(prefix ? `${prefix}.${k}` : k)
        }
      }
      else {
        next.push(prefix ? `${prefix}.${seg}` : seg)
      }
    }
    paths = next
  }
  return paths
}

/**
 * Write `value` at a dot-path, creating intermediate containers. An array is
 * created (rather than an object) when the next segment is a numeric index, so
 * a wildcard rule on `tags.*` rebuilds `tags` as an array — not `{0: …}`.
 */
function setPath(out: Data, path: string, value: unknown): void {
  const segments = path.split('.')
  let node: Record<string, unknown> = out
  for (let i = 0; i < segments.length - 1; i++) {
    const key = segments[i] as string
    const existing = node[key]
    if (existing === null || typeof existing !== 'object') {
      node[key] = /^\d+$/.test(segments[i + 1] as string) ? [] : {}
    }
    node = node[key] as Record<string, unknown>
  }
  node[segments[segments.length - 1] as string] = value
}

function isRuleObject(entry: unknown): entry is RuleObject {
  return (
    typeof entry === 'object'
    && entry !== null
    && typeof (entry as RuleObject).validate === 'function'
  )
}

function splitRules(fieldRules: string | RuleEntry[]): {
  parsed: ParsedRule[]
  customs: (ClosureRule | RuleObject)[]
} {
  const entries = Array.isArray(fieldRules) ? fieldRules : fieldRules.split('|')
  const parsed: ParsedRule[] = []
  const customs: (ClosureRule | RuleObject)[] = []
  for (const entry of entries) {
    if (typeof entry === 'function') {
      customs.push(entry)
    }
    else if (isRuleObject(entry)) {
      customs.push(entry)
    }
    else {
      const token = entry.trim()
      if (!token)
        continue
      const idx = token.indexOf(':')
      if (idx === -1) {
        parsed.push({ name: token, args: [] })
      }
      else {
        const name = token.slice(0, idx)
        const rest = token.slice(idx + 1)
        // A regex pattern is ONE argument — splitting on commas mangles any
        // quantifier or character class containing one, so `regex:^\d{3,5}$`
        // compiled as `^\d{3` and rejected valid input (and `^[a-z,]+$` threw
        // out of errors()). Laravel special-cases these two rules the same way.
        const args = name === 'regex' || name === 'not_regex' ? [rest] : rest.split(',')
        parsed.push({ name, args })
      }
    }
  }
  return { parsed, customs }
}

function sizeKindOf(names: Set<string>): SizeKind {
  if (names.has('file') || names.has('image'))
    return 'file'
  if (names.has('numeric') || names.has('integer'))
    return 'numeric'
  if (names.has('array'))
    return 'array'
  return 'string'
}

/** Should the field be excluded (removed + not validated) per its exclude rules? */
function isExcluded(parsed: ParsedRule[], data: Data): boolean {
  for (const { name, args } of parsed) {
    if (name === 'exclude')
      return true
    // Dotted other-field names must resolve too — a flat lookup made
    // `exclude_if:addr.country,ID` compare `undefined`, so `exclude_if` never
    // fired and `exclude_unless` fired ALWAYS (silently dropping the field).
    if (name === 'exclude_if' && String(getValue(data, args[0] as string)) === args[1])
      return true
    if (name === 'exclude_unless' && String(getValue(data, args[0] as string)) !== args[1])
      return true
    if (name === 'exclude_with' && hasPath(data, args[0] as string))
      return true
    if (name === 'exclude_without' && !hasPath(data, args[0] as string))
      return true
  }
  return false
}

const FLOW = new Set([
  'nullable',
  'sometimes',
  'bail',
  'exclude',
  'exclude_if',
  'exclude_unless',
  'exclude_with',
  'exclude_without',
])

/**
 * Laravel-style validator: rules as a piped string or array per field (with
 * dot/`*` nested paths and custom closures), yielding a Laravel-shaped error bag.
 */
export class Validator {
  private readonly conditional: {
    fields: string[]
    rules: Rules
    when(data: Data): boolean
  }[] = []

  private readonly afterHooks: ((v: { add(field: string, message: string): void }) => void)[]
    = []

  private excluded = new Set<string>()

  constructor(
    private readonly data: Data,
    private readonly rules: Rules,
    private readonly options: ValidatorOptions = {},
  ) {}

  static make(data: Data, rules: Rules, options?: ValidatorOptions): Validator {
    return new Validator(data, rules, options)
  }

  /** Add rules that only apply when `when(data)` is true (à la Laravel `sometimes`). */
  sometimes(fields: string | string[], rules: Rules, when: (data: Data) => boolean): this {
    this.conditional.push({ fields: Array.isArray(fields) ? fields : [fields], rules, when })
    return this
  }

  /** Register a callback run after validation to add extra errors. */
  after(hook: (v: { add(field: string, message: string): void }) => void): this {
    this.afterHooks.push(hook)
    return this
  }

  async errors(): Promise<ErrorBag> {
    const bag: ErrorBag = {}
    this.excluded = new Set()

    const allRules: Rules = { ...this.rules }
    for (const c of this.conditional) {
      if (c.when(this.data))
        Object.assign(allRules, c.rules)
    }

    for (const [ruleKey, fieldRules] of Object.entries(allRules)) {
      const { parsed, customs } = splitRules(fieldRules)

      if (isExcluded(parsed, this.data)) {
        // Record the EXPANDED paths, not the top-level segment: excluding
        // `items.*.q` must drop only those leaves, not the whole `items`
        // array along with its validated siblings.
        for (const path of expandKey(ruleKey, this.data)) this.excluded.add(path)
        continue
      }

      const names = new Set(parsed.map(r => r.name))
      const kind = sizeKindOf(names)
      const bail = names.has('bail')
      const paths = expandKey(ruleKey, this.data)

      // Precompute values for `distinct` (unique across the wildcard group).
      const distinctValues = names.has('distinct') ? paths.map(p => getValue(this.data, p)) : null

      for (const path of paths) {
        const value = getValue(this.data, path)
        const present = hasPath(this.data, path)
        const empty = isEmpty(value)

        if (names.has('sometimes') && !present)
          continue

        const add = (message: string) => {
          ;(bag[path] ??= []).push(message)
        }
        let failed = false

        for (const { name, args } of parsed) {
          if (FLOW.has(name))
            continue

          if (name === 'distinct') {
            const dupes = distinctValues?.filter(x => x === value).length ?? 0
            if (dupes > 1) {
              add(
                formatMessage({
                  rule: 'distinct',
                  attribute: path,
                  args,
                  sizeKind: kind,
                  ...this.opts(),
                }),
              )
              failed = true
              if (bail)
                break
            }
            continue
          }

          const rule = RULES[name]
          if (!rule)
            throw new Error(`[elyvel] Unknown validation rule "${name}".`)
          if (empty && !rule.implicit)
            continue

          const ok = await rule.validate(value, args, this.data, path, kind)
          if (!ok) {
            add(
              formatMessage({ rule: name, attribute: path, args, sizeKind: kind, ...this.opts() }),
            )
            failed = true
            if (bail)
              break
          }
        }

        if (bail && failed)
          continue

        for (const custom of customs) {
          const fail: FailFn = (message) => {
            add(message)
            failed = true
          }
          const ctx = { attribute: path, data: this.data }
          if (typeof custom === 'function')
            await custom(value, fail, ctx)
          else await custom.validate(value, fail, ctx)
          if (bail && failed)
            break
        }
      }
    }

    for (const hook of this.afterHooks) {
      hook({ add: (field, message) => void (bag[field] ??= []).push(message) })
    }
    return bag
  }

  private opts() {
    return { custom: this.options.messages, attributes: this.options.attributes }
  }

  async passes(): Promise<boolean> {
    return Object.keys(await this.errors()).length === 0
  }

  async fails(): Promise<boolean> {
    return !(await this.passes())
  }

  /** Validate; return the validated fields, or throw {@link ValidationException}. */
  async validate(): Promise<Data> {
    const bag = await this.errors()
    if (Object.keys(bag).length > 0)
      throw new ValidationException(bag)
    return this.validated()
  }

  /**
   * The subset of data the rules actually cover — built from the validated
   * LEAF paths, not their top-level parents.
   *
   * This used to return `data[key.split('.')[0]]`, i.e. the whole parent
   * object for any nested rule: a rule set of `{'user.name': 'required'}`
   * handed back all of `user`, so `{name, is_admin}` sailed through into
   * `validated()` with `is_admin` never validated at all — mass assignment
   * straight past the validator. A wildcard rule whose data wasn't an array
   * (so it expanded to zero paths, validating nothing) leaked the raw value
   * the same way.
   */
  validated(): Data {
    const out: Data = {}
    for (const key of Object.keys(this.rules)) {
      for (const path of expandKey(key, this.data)) {
        if (this.excluded.has(path))
          continue
        if (hasPath(this.data, path))
          setPath(out, path, getValue(this.data, path))
      }
    }
    return out
  }

  /** `safe().only([...])` / `safe().except([...])` over the validated data. */
  safe() {
    const data = this.validated()
    return {
      only: (keys: string[]) =>
        Object.fromEntries(keys.filter(k => k in data).map(k => [k, data[k]])),
      except: (keys: string[]) =>
        Object.fromEntries(
          Object.keys(data)
            .filter(k => !keys.includes(k))
            .map(k => [k, data[k]]),
        ),
    }
  }
}

/** Validate `data` against `rules`; returns validated data or throws. */
export function validate(data: Data, rules: Rules, options?: ValidatorOptions): Promise<Data> {
  return Validator.make(data, rules, options).validate()
}
