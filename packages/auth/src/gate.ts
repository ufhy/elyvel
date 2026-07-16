import type { Authenticatable } from './types'

/**
 * The outcome of an authorization check (Laravel's `Access\Response`). Carries
 * an allow/deny flag, an optional message, and an HTTP status for denials.
 */
export class Response {
  private constructor(
    private readonly isAllowed: boolean,
    private readonly msg: string | undefined,
    private readonly code: number,
  ) {}

  static allow(message?: string): Response {
    return new Response(true, message, 200)
  }

  static deny(message = 'This action is unauthorized.', status = 403): Response {
    return new Response(false, message, status)
  }

  static denyWithStatus(status: number, message?: string): Response {
    return new Response(false, message, status)
  }

  static denyAsNotFound(message = 'Not Found.'): Response {
    return new Response(false, message, 404)
  }

  allowed(): boolean {
    return this.isAllowed
  }

  denied(): boolean {
    return !this.isAllowed
  }

  message(): string | undefined {
    return this.msg
  }

  status(): number {
    return this.code
  }

  /** Throw {@link AuthorizationError} when denied; return self when allowed. */
  authorize(): this {
    if (this.denied())
      throw new AuthorizationError(this.msg, this.code)
    return this
  }
}

export class AuthorizationError extends Error {
  readonly status: number
  constructor(message = 'This action is unauthorized.', status = 403) {
    super(message)
    this.name = 'AuthorizationError'
    this.status = status
  }
}

type Args = any[]
type Raw = boolean | Response
type BeforeHook<U> = (user: U | null, ability: string, args: Args) => Raw | null | undefined
type AfterHook<U> = (
  user: U | null,
  ability: string,
  result: boolean | null,
  args: Args,
) => Raw | null | undefined
type Ability<U> = (user: U | null, ...args: Args) => Raw
interface AbilityOptions {
  /** Run the ability for unauthenticated (null) users too. Default false. */
  allowGuest?: boolean
}

/** A constructor usable as a policy key. */
type ModelCtor = abstract new (...args: any[]) => any
/**
 * A policy: an object whose methods are abilities for a model, with an optional
 * `before` filter. Implement it on a plain class — method names are the abilities.
 */
export interface Policy<U = any> {
  before?(user: U | null, ability: string): Raw | null | undefined
}
/** Internal loose view for dynamic ability lookup by name. */
type PolicyBag<U> = {
  before?(user: U | null, ability: string): Raw | null | undefined
} & Record<string, unknown>

/**
 * Authorization gate — the Elysia-first take on Laravel's Gate. Register named
 * abilities (closures) and/or policies (grouped per model), then check them.
 *
 * @example
 * const gate = createGate<User>()
 *   .define('admin', (user) => user?.role === 'admin')
 *   .policy(Post, new PostPolicy())
 *
 * gate.allows('admin', user)                    // boolean
 * gate.allows('update', user, post)             // routes to PostPolicy.update
 * gate.forUser(user).authorize('update', post)  // throws AuthorizationError if denied
 */
export class Gate<U extends Authenticatable = Authenticatable> {
  private readonly abilities = new Map<string, Ability<U>>()
  private readonly abilityOptions = new Map<string, AbilityOptions>()
  private readonly policies = new Map<ModelCtor, PolicyBag<U>>()
  private readonly beforeHooks: BeforeHook<U>[] = []
  private readonly afterHooks: AfterHook<U>[] = []

  /** Register a named ability. */
  define(ability: string, callback: Ability<U>, options: AbilityOptions = {}): this {
    this.abilities.set(ability, callback)
    this.abilityOptions.set(ability, options)
    return this
  }

  /**
   * Register a policy for a model class. Its methods become abilities for that
   * model — implement the {@link Policy} shape on a plain class.
   */
  policy(model: ModelCtor, policy: Policy<U> | object): this {
    this.policies.set(model, policy as PolicyBag<U>)
    return this
  }

  /** Run before any check; a non-null return short-circuits the result. */
  before(hook: BeforeHook<U>): this {
    this.beforeHooks.push(hook)
    return this
  }

  /** Run after a check; only overrides when the ability itself returned null. */
  after(hook: AfterHook<U>): this {
    this.afterHooks.push(hook)
    return this
  }

  // ── checks ────────────────────────────────────────────────────────────────
  allows(ability: string, user: U | null, ...args: Args): boolean {
    return this.raw(ability, user, args).allowed()
  }

  denies(ability: string, user: U | null, ...args: Args): boolean {
    return !this.allows(ability, user, ...args)
  }

  check(ability: string, user: U | null, ...args: Args): boolean {
    return this.allows(ability, user, ...args)
  }

  any(abilities: string[], user: U | null, ...args: Args): boolean {
    return abilities.some(a => this.allows(a, user, ...args))
  }

  none(abilities: string[], user: U | null, ...args: Args): boolean {
    return !this.any(abilities, user, ...args)
  }

  /** Full {@link Response} for a check (Laravel's `Gate::inspect`). */
  inspect(ability: string, user: U | null, ...args: Args): Response {
    return this.raw(ability, user, args)
  }

  /** Throw {@link AuthorizationError} (with the response's status/message) unless allowed. */
  authorize(ability: string, user: U | null, ...args: Args): Response {
    return this.raw(ability, user, args).authorize()
  }

  // ── inline authorization (skips before/after) ──────────────────────────────
  allowIf(
    condition: boolean | ((user: U | null) => boolean),
    user: U | null,
    message?: string,
  ): void {
    const ok = typeof condition === 'function' ? condition(user) : condition
    if (!ok || user == null)
      throw new AuthorizationError(message)
  }

  denyIf(
    condition: boolean | ((user: U | null) => boolean),
    user: U | null,
    message?: string,
  ): void {
    const denied = typeof condition === 'function' ? condition(user) : condition
    if (denied)
      throw new AuthorizationError(message)
  }

  /** Bind a user, returning a checker whose methods drop the `user` argument. */
  forUser(user: U | null): GateForUser<U> {
    return new GateForUser<U>(this, user)
  }

  // ── resolution ──────────────────────────────────────────────────────────────
  private raw(ability: string, user: U | null, args: Args): Response {
    for (const hook of this.beforeHooks) {
      const r = hook(user, ability, args)
      if (r !== null && r !== undefined)
        return toResponse(r)
    }
    let result = this.callAbility(ability, user, args)
    for (const hook of this.afterHooks) {
      const r = hook(user, ability, result?.allowed() ?? null, args)
      if (result === null && r !== null && r !== undefined)
        result = toResponse(r)
    }
    return result ?? Response.deny()
  }

  /** Resolve via a policy if one matches args[0], else a named ability. `null` = no handler. */
  private callAbility(ability: string, user: U | null, args: Args): Response | null {
    const viaPolicy = this.callPolicy(ability, user, args)
    if (viaPolicy !== undefined)
      return viaPolicy

    const cb = this.abilities.get(ability)
    if (!cb)
      return null
    if (user == null && !this.abilityOptions.get(ability)?.allowGuest)
      return Response.deny()
    return toResponse(cb(user, ...args))
  }

  /** `undefined` = no policy for these args; `null` = policy exists but lacks the method. */
  private callPolicy(ability: string, user: U | null, args: Args): Response | null | undefined {
    const target = args[0]
    const ctor: ModelCtor | undefined
      = typeof target === 'function' ? (target as ModelCtor) : target?.constructor
    const policy = ctor ? this.policies.get(ctor) : undefined
    if (!policy)
      return undefined

    const method = policy[ability]
    if (typeof method !== 'function')
      return null

    if (typeof policy.before === 'function') {
      const r = policy.before(user, ability)
      if (r !== null && r !== undefined)
        return toResponse(r)
    }
    if (user == null)
      return Response.deny()

    // `create`-style checks pass the class as args[0]; drop it before the method.
    const methodArgs = typeof target === 'function' ? args.slice(1) : args
    return toResponse((method as (user: U | null, ...a: Args) => Raw)(user, ...methodArgs))
  }
}

/** A user-bound view of a {@link Gate} — the per-request ergonomic surface. */
export class GateForUser<U extends Authenticatable = Authenticatable> {
  constructor(
    private readonly gate: Gate<U>,
    private readonly user: U | null,
  ) {}

  allows(ability: string, ...args: Args): boolean {
    return this.gate.allows(ability, this.user, ...args)
  }

  denies(ability: string, ...args: Args): boolean {
    return this.gate.denies(ability, this.user, ...args)
  }

  can(ability: string, ...args: Args): boolean {
    return this.gate.allows(ability, this.user, ...args)
  }

  cannot(ability: string, ...args: Args): boolean {
    return this.gate.denies(ability, this.user, ...args)
  }

  any(abilities: string[], ...args: Args): boolean {
    return this.gate.any(abilities, this.user, ...args)
  }

  none(abilities: string[], ...args: Args): boolean {
    return this.gate.none(abilities, this.user, ...args)
  }

  inspect(ability: string, ...args: Args): Response {
    return this.gate.inspect(ability, this.user, ...args)
  }

  authorize(ability: string, ...args: Args): Response {
    return this.gate.authorize(ability, this.user, ...args)
  }
}

function toResponse(value: Raw): Response {
  if (value instanceof Response)
    return value
  return value ? Response.allow() : Response.deny()
}

export function createGate<U extends Authenticatable = Authenticatable>(): Gate<U> {
  return new Gate<U>()
}

// ── process-wide default gate (configured in a service provider) ─────────────
let defaultGate: Gate<any> | null = null

export function setDefaultGate<U extends Authenticatable>(instance: Gate<U>): void {
  defaultGate = instance
}

/** The process-wide default gate (created lazily). Configure it in a provider. */
export function gate<U extends Authenticatable = Authenticatable>(): Gate<U> {
  if (!defaultGate)
    defaultGate = new Gate()
  return defaultGate
}
