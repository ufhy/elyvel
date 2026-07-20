import type { CustomRuleContext, FailFn, RuleObject } from './validator'
import { createHash } from 'node:crypto'
import { trans } from '@elyvel/support'
import { humanizeAttribute } from './messages'
import { isEmpty } from './rules'

/**
 * Password complexity rules (Laravel's `Illuminate\Validation\Rules\Password`).
 * A rule OBJECT, not a piped string — use it in the array form of a field's
 * rules alongside `required`:
 *
 * @example
 * { password: ['required', Password.min(8).mixedCase().numbers().symbols()] }
 *
 * Doesn't enforce presence itself (empty values pass through untouched —
 * pair it with `required` for that), matching Laravel's own Password rule.
 */
export class Password implements RuleObject {
  private minLength = 8
  private requireLetters = false
  private requireMixedCase = false
  private requireNumbers = false
  private requireSymbols = false
  private requireUncompromised = false
  private uncompromisedThreshold = 0

  /** Start a rule requiring at least `length` characters (default 8). */
  static min(length: number): Password {
    const p = new Password()
    p.minLength = length
    return p
  }

  /** Require at least one letter (a-z or A-Z). */
  letters(): this {
    this.requireLetters = true
    return this
  }

  /** Require at least one lowercase AND one uppercase letter. */
  mixedCase(): this {
    this.requireMixedCase = true
    return this
  }

  /** Require at least one digit. */
  numbers(): this {
    this.requireNumbers = true
    return this
  }

  /** Require at least one non-alphanumeric character. */
  symbols(): this {
    this.requireSymbols = true
    return this
  }

  /**
   * Reject passwords that have appeared in a known data breach, checked via
   * the "Have I Been Pwned" range API using k-anonymity: only the first 5
   * hex characters of the password's SHA-1 hash are ever sent, never the
   * password or the full hash. `threshold` allows a password that's merely
   * appeared a small number of times (default 0 — reject any appearance).
   * Fails OPEN (treats the check as passed) if the API is unreachable, so a
   * network hiccup can't block registration/password changes.
   */
  uncompromised(threshold = 0): this {
    this.requireUncompromised = true
    this.uncompromisedThreshold = threshold
    return this
  }

  private static defaultsFactory: (() => Password) | undefined
  /** Set the app-wide default rule set, used by {@link Password.default}. */
  static defaults(factory: () => Password): void {
    Password.defaultsFactory = factory
  }

  /** The app's configured default (via {@link Password.defaults}), or a plain `min(8)`. */
  static default(): Password {
    return Password.defaultsFactory ? Password.defaultsFactory() : Password.min(8)
  }

  async validate(value: unknown, fail: FailFn, ctx: CustomRuleContext): Promise<void> {
    if (isEmpty(value))
      return // presence is `required`'s job, not this rule's
    const str = typeof value === 'string' ? value : String(value)
    const name = humanizeAttribute(ctx.attribute)

    if (str.length < this.minLength) {
      fail(trans('validation::password.min', { attribute: name, min: String(this.minLength) }, `The ${name} field must be at least ${this.minLength} characters.`))
    }
    if (this.requireLetters && !/[a-z]/i.test(str)) {
      fail(trans('validation::password.letters', { attribute: name }, `The ${name} field must contain at least one letter.`))
    }
    if (this.requireMixedCase && !(/[a-z]/.test(str) && /[A-Z]/.test(str))) {
      fail(trans('validation::password.mixed_case', { attribute: name }, `The ${name} field must contain at least one uppercase and one lowercase letter.`))
    }
    if (this.requireNumbers && !/\d/.test(str)) {
      fail(trans('validation::password.numbers', { attribute: name }, `The ${name} field must contain at least one number.`))
    }
    if (this.requireSymbols && !/[^a-z0-9]/i.test(str)) {
      fail(trans('validation::password.symbols', { attribute: name }, `The ${name} field must contain at least one symbol.`))
    }
    if (this.requireUncompromised && (await breachCount(str)) > this.uncompromisedThreshold) {
      fail(trans('validation::password.uncompromised', { attribute: name }, `The given ${name} has appeared in a data leak. Please choose a different ${name}.`))
    }
  }
}

/** How many times a password appears in the HIBP breach corpus (0 on any failure — fail open). */
async function breachCount(password: string): Promise<number> {
  try {
    const sha1 = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase()
    const prefix = sha1.slice(0, 5)
    const suffix = sha1.slice(5)
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`)
    if (!res.ok)
      return 0
    const body = await res.text()
    for (const line of body.split('\n')) {
      const [lineSuffix, count] = line.trim().split(':')
      if (lineSuffix === suffix)
        return Number(count ?? 0)
    }
    return 0
  }
  catch {
    return 0 // network unreachable, offline dev, etc. — fail open
  }
}
