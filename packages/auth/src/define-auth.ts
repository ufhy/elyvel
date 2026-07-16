import type { BetterAuthOptions } from 'better-auth'
import { betterAuth } from 'better-auth'
import { twoFactor } from 'better-auth/plugins'
import { eloquentAdapter } from './eloquent-adapter'

/** Sends one of the auth emails (password reset / address verification). */
export type AuthMailer = (data: {
  user: { email: string, name?: string | null }
  url: string
  token: string
}) => void | Promise<void>

export interface DefineAuthOptions {
  /**
   * Social providers to offer. Each one activates ONLY when both its client id
   * and secret are present in the environment (e.g. GITHUB_CLIENT_ID + SECRET),
   * so social sign-in stays opt-in per deploy.
   */
  social?: SocialProvider[]
  /** Enable TOTP two-factor auth (adds the `twoFactor` table). Default `true`. */
  twoFactor?: boolean
  /** Cookie name prefix. Default: a slug of `APP_NAME` (falls back to `app`). */
  cookiePrefix?: string
  /** Deliver the password-reset link (usually via `@elysia-ravel/mail`). */
  sendResetPassword?: AuthMailer
  /** Deliver the email-verification link. Verification is sent on sign-up. */
  sendVerificationEmail?: AuthMailer
  /** Escape hatch: raw Better Auth options, merged last (these win). */
  betterAuth?: Partial<BetterAuthOptions>
}

export type SocialProvider = 'github' | 'google' | 'gitlab' | 'discord' | 'apple' | 'facebook'

const SOCIAL_ENV: Record<SocialProvider, [id: string, secret: string]> = {
  github: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
  google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  gitlab: ['GITLAB_CLIENT_ID', 'GITLAB_CLIENT_SECRET'],
  discord: ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET'],
  apple: ['APPLE_CLIENT_ID', 'APPLE_CLIENT_SECRET'],
  facebook: ['FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET'],
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'app'
}

/** Enabled providers keyed for Better Auth (only those with env credentials set). */
function resolveSocial(names: SocialProvider[]): Record<string, { clientId: string, clientSecret: string }> {
  const out: Record<string, { clientId: string, clientSecret: string }> = {}
  for (const name of names) {
    const [idKey, secretKey] = SOCIAL_ENV[name]
    const clientId = process.env[idKey]
    const clientSecret = process.env[secretKey]
    if (clientId && clientSecret)
      out[name] = { clientId, clientSecret }
  }
  return out
}

/**
 * Build the app's Better Auth instance from a Laravel-style config, pre-wiring
 * the framework glue: the Eloquent adapter, a secret derived from APP_KEY, the
 * base URL, a per-app cookie prefix, email/password + verification, env-gated
 * social providers, and the two-factor plugin. Configure it in `config/auth.ts`.
 * Anything not covered goes through the `betterAuth` escape hatch.
 */
export function defineAuth(options: DefineAuthOptions = {}): ReturnType<typeof betterAuth> {
  const appName = process.env.APP_NAME
  const cookiePrefix = options.cookiePrefix ?? (appName ? slug(appName) : 'app')

  return betterAuth({
    database: eloquentAdapter(),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: options.sendResetPassword,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: options.sendVerificationEmail,
    },
    socialProviders: resolveSocial(options.social ?? []),
    plugins: options.twoFactor === false ? [] : [twoFactor({ issuer: appName ?? 'app' })],
    advanced: { cookiePrefix },
    // Session-signing secret — never ship a hardcoded fallback. The app already
    // refuses to boot without APP_KEY (cookie session driver), so this is set.
    secret: process.env.BETTER_AUTH_SECRET ?? process.env.APP_KEY,
    baseURL: process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
    ...options.betterAuth,
  } as BetterAuthOptions)
}

/** Names of the social providers actually enabled — feeds the login/register UI. */
export function enabledSocialProviders(auth: ReturnType<typeof betterAuth>): string[] {
  return Object.keys(auth.options.socialProviders ?? {})
}
