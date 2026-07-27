import type { BetterAuthOptions } from 'better-auth'
import { Str } from '@elyvel/support'
import { Password } from '@elyvel/validation'
import { betterAuth } from 'better-auth'
import { getSchema } from 'better-auth/db'
import { composeBefore } from './auth-hooks'
import { eloquentAdapter } from './eloquent-adapter'

/** The 4 core models Better Auth always has, keyed the same as its own options. */
const CORE_MODELS = ['user', 'session', 'account', 'verification'] as const

/**
 * Better Auth's own fields are camelCase (`emailVerified`, `userId`, ...) —
 * remap each one to its snake_case column name so the physical schema matches
 * every other Eloquent table in the framework. This only changes the stored
 * column name (Better Auth reads it back via `fieldName`); the JS-level
 * property name apps see (`ctx.user.emailVerified`, `session.userId`, ...) is
 * completely unaffected. Scoped to the 4 core models' OWN known fields —
 * verified NOT to cover: (1) a plugin's own separate table (e.g.
 * `twoFactor()`'s `twoFactor` table), and (2) a plugin's additional field
 * merged onto a core table (e.g. `twoFactor()`'s `users.twoFactorEnabled`) —
 * both stay in whatever casing the plugin itself hardcodes, since Better
 * Auth resolves those independently of this model-level `fields` map. Pass
 * `fields`/`additionalFields` into that plugin's own options if you want it
 * snake_case too (plugin-specific, not something this helper can do generically).
 *
 * `getSchema()` keys its output by the resolved `modelName` (table name), NOT
 * the internal model id, once `modelName` is set — so each model's own
 * `options.<model>.modelName` (falling back to its elyvel default) is looked
 * up dynamically rather than assumed, in case an app ever overrides it.
 */
function snakeCaseCoreFields(options: BetterAuthOptions): Record<(typeof CORE_MODELS)[number], { fields: Record<string, string> }> {
  const defaultModelNames: Record<(typeof CORE_MODELS)[number], string> = {
    user: 'users',
    session: 'sessions',
    account: 'accounts',
    verification: 'verifications',
  }
  const schema = getSchema(options) as Record<string, { fields: Record<string, unknown> }>
  const result = {} as Record<(typeof CORE_MODELS)[number], { fields: Record<string, string> }>
  for (const model of CORE_MODELS) {
    const tableName = (options as Record<string, { modelName?: string } | undefined>)[model]?.modelName
      ?? defaultModelNames[model]
    const fields: Record<string, string> = {}
    for (const field of Object.keys(schema[tableName]?.fields ?? {})) fields[field] = Str.snake(field)
    result[model] = { fields }
  }
  return result
}

/**
 * `config/auth.ts` is authored with **native Better Auth options** — plugins
 * (incl. `twoFactor()`), `socialProviders`, `emailAndPassword`, etc. The
 * framework only fills in glue defaults (Eloquent adapter, APP_KEY secret, base
 * URL, cookie prefix, Eloquent-plural table names); everything you pass wins.
 */
/**
 * Which auth endpoints the app exposes (Laravel Fortify's `features` array).
 * Setting one to `false` removes its route entirely — a real 404 (via Better
 * Auth's `disabledPaths`), so a disabled feature is indistinguishable from a
 * non-existent one, not an existing-but-forbidden endpoint. HTTP-only: the
 * programmatic `auth.api.*` still works, so a closed `registration` still lets
 * you create users server-side (invite-only) or from your own custom route.
 * Omitted features keep Better Auth's own default (mostly on; delete-user off).
 */
export interface AuthFeatures {
  /** `POST /sign-up/email`. Off = invite-only / bring-your-own registration route. */
  registration?: boolean
  /** `POST /sign-in/email` (email + password login). */
  signIn?: boolean
  /** `POST /sign-in/social` (OAuth provider login). */
  socialSignIn?: boolean
  /** `POST /sign-out`. */
  signOut?: boolean
  /** Session management: `/list-sessions`, `/revoke-session(s)`, `/revoke-other-sessions`. */
  sessions?: boolean
  /** `POST /request-password-reset` + `/reset-password`. */
  passwordReset?: boolean
  /** `GET /verify-email` + `POST /send-verification-email`. */
  emailVerification?: boolean
  /** `POST /change-password`. */
  updatePassword?: boolean
  /** `POST /change-email`. */
  changeEmail?: boolean
  /** `POST /update-user`. */
  updateProfile?: boolean
  /** Linked accounts: `/list-accounts`, `/link-social`, `/unlink-account`, `/account-info`. */
  accounts?: boolean
  /** `POST /delete-user` + callback. */
  deleteUser?: boolean
}

/**
 * Feature → the base-relative endpoint paths it gates (matched exactly by
 * `disabledPaths`). `/get-session` is deliberately NOT gateable here — the
 * plugin's session derive and typical client session checks depend on it; close
 * it with an explicit `disabledPaths` if you truly must.
 */
const FEATURE_PATHS: Record<keyof AuthFeatures, string[]> = {
  registration: ['/sign-up/email'],
  signIn: ['/sign-in/email'],
  socialSignIn: ['/sign-in/social'],
  signOut: ['/sign-out'],
  sessions: ['/list-sessions', '/revoke-session', '/revoke-sessions', '/revoke-other-sessions'],
  passwordReset: ['/request-password-reset', '/reset-password'],
  emailVerification: ['/verify-email', '/send-verification-email'],
  updatePassword: ['/change-password'],
  changeEmail: ['/change-email'],
  updateProfile: ['/update-user'],
  accounts: ['/list-accounts', '/link-social', '/unlink-account', '/account-info'],
  deleteUser: ['/delete-user', '/delete-user/callback'],
}

export type DefineAuthOptions = Partial<BetterAuthOptions> & {
  /** Where to redirect a guest hitting a protected page (browser). Default `/login`. */
  loginPath?: string
  /** Where to redirect an unverified user (browser). Default `/verify-email`. */
  verifyPath?: string
  /** Which auth endpoints to expose — see {@link AuthFeatures}. */
  features?: AuthFeatures
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'app'
}

/**
 * Identity helper that pins the type of `config/auth.ts` — the auth counterpart
 * of `defineAppConfig`. Keeps the config file plain data (`export default
 * defineAuthConfig({...})`) so it lands in the config repository like every
 * other `config/*.ts`; the instance is built from it by {@link AuthServiceProvider}.
 */
export function defineAuthConfig(config: DefineAuthOptions): DefineAuthOptions {
  return config
}

/**
 * Build the app's Better Auth instance from native Better Auth options, layering
 * the framework glue underneath: the Eloquent adapter, a secret derived from
 * APP_KEY, the base URL, a per-app cookie prefix (slug of APP_NAME), and
 * Eloquent-plural core table names. Your options override every default.
 *
 * Table names use per-model `modelName` (respected by BOTH the adapter and
 * getSchema, so migrations and queries agree). Add features as plugins, e.g.
 * `plugins: [twoFactor()]` — nothing is forced on.
 */
export function defineAuth(options: DefineAuthOptions = {}): ReturnType<typeof betterAuth> {
  const appName = process.env.APP_NAME
  const cookiePrefix = appName ? slug(appName) : 'app'
  // loginPath/verifyPath are framework redirect targets (read by the auth guards
  // via `config('auth.*')`), NOT Better Auth options — keep them out of the instance.
  // `features` maps to Better Auth's `disabledPaths` below.
  const { loginPath: _loginPath, verifyPath: _verifyPath, features, ...ba } = options

  // Turn `features: { x: false }` into disabled endpoint paths (a real 404),
  // merged with any explicit `disabledPaths` the app already set.
  const disabledPaths = new Set(ba.disabledPaths ?? [])
  for (const [key, enabled] of Object.entries(features ?? {})) {
    if (enabled === false)
      FEATURE_PATHS[key as keyof AuthFeatures]?.forEach(path => disabledPaths.add(path))
  }

  // Resolve everything except the snake_case fields remap first — computing
  // it needs the fully-merged options (so plugin-contributed fields on the
  // 4 core models are seen too) via Better Auth's own `getSchema`.
  const resolved = {
    user: { modelName: 'users' },
    session: { modelName: 'sessions' },
    account: { modelName: 'accounts' },
    verification: { modelName: 'verifications' },
    database: eloquentAdapter(),
    // Session-signing secret — never ship a hardcoded fallback. The app already
    // refuses to boot without APP_KEY (cookie session driver), so this is set.
    secret: process.env.BETTER_AUTH_SECRET ?? process.env.APP_KEY,
    baseURL: process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
    ...ba,
    // Deep-merge the nested defaults so a partial override keeps the glue.
    // `minPasswordLength` mirrors the app-wide `Password.defaults()` policy
    // (Laravel's `Password::defaults()`) so Better Auth's own floor agrees with
    // what the framework validator enforces — one source of truth. An explicit
    // `minPasswordLength` in config/auth.ts still wins (spread after).
    emailAndPassword: { enabled: true, minPasswordLength: Password.default().length, ...ba.emailAndPassword },
    emailVerification: { sendOnSignUp: true, ...ba.emailVerification },
    advanced: { cookiePrefix, ...ba.advanced },
    // Validate registration through the bound FormRequest (see auth-hooks.ts) —
    // runs for the HTTP route and programmatic `auth.api.signUpEmail()` alike.
    // Composed with any `before` hook the app declared, ours first.
    hooks: { ...ba.hooks, before: composeBefore(ba.hooks?.before) },
    // Disabled feature endpoints → real 404 (see AuthFeatures). After `...ba`
    // so the computed set (which already folded in ba.disabledPaths) wins.
    disabledPaths: [...disabledPaths],
  } as BetterAuthOptions

  // Snake-case every core field's storage column — an explicit `fields`
  // override the app already set (on `ba.user`/etc) still wins.
  const snake = snakeCaseCoreFields(resolved)
  return betterAuth({
    ...resolved,
    user: { ...resolved.user, fields: { ...snake.user.fields, ...resolved.user?.fields } },
    session: { ...resolved.session, fields: { ...snake.session.fields, ...resolved.session?.fields } },
    account: { ...resolved.account, fields: { ...snake.account.fields, ...resolved.account?.fields } },
    verification: { ...resolved.verification, fields: { ...snake.verification.fields, ...resolved.verification?.fields } },
  } as BetterAuthOptions)
}

/** Names of the social providers actually enabled — feeds the login/register UI. */
export function enabledSocialProviders(auth: ReturnType<typeof betterAuth>): string[] {
  return Object.keys(auth.options.socialProviders ?? {})
}
