import { formatMessage, type SizeKind } from './messages'
import { isEmpty, RULES } from './rules'
import { type ErrorBag, ValidationException } from './validation-exception'

export type Data = Record<string, unknown>
/** Rules per field: a piped string (`'required|email'`) or an array (`['required','email']`). */
export type Rules = Record<string, string | string[]>

export interface ValidatorOptions {
  /** Custom messages keyed by `rule` or `field.rule` (à la Laravel). */
  messages?: Record<string, string>
  /** Custom display names for `:attribute`. */
  attributes?: Record<string, string>
}

interface ParsedRule {
  name: string
  args: string[]
}

function parseFieldRules(rules: string | string[]): ParsedRule[] {
  const tokens = Array.isArray(rules) ? rules : rules.split('|')
  return tokens
    .map((t) => t.trim())
    .filter(Boolean)
    .map((token) => {
      const idx = token.indexOf(':')
      if (idx === -1) return { name: token, args: [] }
      return { name: token.slice(0, idx), args: token.slice(idx + 1).split(',') }
    })
}

function sizeKindOf(names: Set<string>): SizeKind {
  if (names.has('numeric') || names.has('integer')) return 'numeric'
  if (names.has('array')) return 'array'
  return 'string'
}

/**
 * Laravel-style validator: define rules as a piped string or array per field,
 * get a Laravel-shaped error bag. Async (supports `unique`/`exists`).
 */
export class Validator {
  constructor(
    private readonly data: Data,
    private readonly rules: Rules,
    private readonly options: ValidatorOptions = {},
  ) {}

  static make(data: Data, rules: Rules, options?: ValidatorOptions): Validator {
    return new Validator(data, rules, options)
  }

  /** Run validation; return the error bag (empty if it passes). */
  async errors(): Promise<ErrorBag> {
    const bag: ErrorBag = {}

    for (const [field, fieldRules] of Object.entries(this.rules)) {
      const parsed = parseFieldRules(fieldRules)
      const names = new Set(parsed.map((r) => r.name))
      const kind = sizeKindOf(names)
      const value = this.data[field]
      const present = field in this.data
      const empty = isEmpty(value)

      if (names.has('sometimes') && !present) continue

      for (const { name, args } of parsed) {
        if (name === 'nullable' || name === 'sometimes') continue
        const rule = RULES[name]
        if (!rule) throw new Error(`[elysia-ravel] Unknown validation rule "${name}".`)

        // Skip non-implicit rules when the value is empty (Laravel behavior).
        if (empty && !rule.implicit) continue

        const ok = await rule.validate(value, args, this.data, field, kind)
        if (!ok) {
          ;(bag[field] ??= []).push(
            formatMessage({
              rule: name,
              attribute: field,
              args,
              sizeKind: kind,
              custom: this.options.messages,
              attributes: this.options.attributes,
            }),
          )
        }
      }
    }
    return bag
  }

  async passes(): Promise<boolean> {
    return Object.keys(await this.errors()).length === 0
  }

  async fails(): Promise<boolean> {
    return !(await this.passes())
  }

  /** Validate and return only the validated fields, or throw {@link ValidationException}. */
  async validate(): Promise<Data> {
    const bag = await this.errors()
    if (Object.keys(bag).length > 0) throw new ValidationException(bag)
    return this.validated()
  }

  /** The subset of data covered by the rules (present fields only). */
  validated(): Data {
    const out: Data = {}
    for (const field of Object.keys(this.rules)) {
      if (field in this.data) out[field] = this.data[field]
    }
    return out
  }
}

/** Validate `data` against `rules`; returns validated data or throws. */
export function validate(data: Data, rules: Rules, options?: ValidatorOptions): Promise<Data> {
  return Validator.make(data, rules, options).validate()
}
