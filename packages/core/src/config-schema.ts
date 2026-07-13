import type { LogChannelConfig, LogLevel } from './logger'
import type { ServiceProviderClass } from './service-provider'

/**
 * Shape of `config/app.ts`. Author it with {@link defineAppConfig} to get
 * autocomplete for every field and compile-time errors on typos.
 */
export interface AppConfig {
  /** Human-readable application name. */
  name?: string
  /** Environment, e.g. `local` | `production`. Drives logging defaults. */
  env?: string
  /** App timezone for date *display* (e.g. `Asia/Makassar`). Storage stays UTC. Default `UTC`. */
  timezone?: string
  /** Secret key for encryption (e.g. `encrypted` model casts). */
  key?: string
  /** Port to listen on (overridable by `PORT` env or `listen(port)`). */
  port?: number
  /** Service providers to register at boot, in order. */
  providers?: ServiceProviderClass[]
}

/** Shape of `config/logging.ts`. Author it with {@link defineLoggingConfig}. */
export interface LoggingConfig {
  /** Minimum level to emit. Default `info`. */
  level?: LogLevel
  /** Colorized console output. Default: true unless `app.env === 'production'`. */
  pretty?: boolean
  /** Log every HTTP request/response with a correlation id. Default true. */
  http?: boolean

  // ── Simple mode (no `channels`) ──
  /** Write to this file too (path relative to app root). */
  file?: string
  /** Rotate the simple-mode file at this size. */
  maxBytes?: number
  /** Rotated files to keep in simple mode. */
  maxFiles?: number

  // ── Channel mode ──
  /** Named sinks. Reachable via `app.channel(name)`. */
  channels?: Record<string, LogChannelConfig>
  /** Channel (or `stack`) used by `app.logger`. Default `stack`. */
  default?: string | string[]

  // ── Redaction ──
  /** Context keys to mask (case-insensitive). Defaults to a sensible set. */
  redact?: string[]
  /** Regex sources compiled with the `g` flag and masked in string values. */
  redactPatterns?: string[]
  /** Also redact sensitive keys inside stringified-JSON values. */
  redactJson?: boolean
}

/** Identity helper that pins the type of `config/app.ts` for autocomplete. */
export function defineAppConfig(config: AppConfig): AppConfig {
  return config
}

/** Identity helper that pins the type of `config/logging.ts` for autocomplete. */
export function defineLoggingConfig(config: LoggingConfig): LoggingConfig {
  return config
}

/** Shape of `config/session.ts`. Author it with {@link defineSessionConfig}. */
export interface SessionConfig {
  /**
   * `cookie` (encrypted in the cookie, stateless), `memory` (dev/test), `file`
   * (server-side files), or `database`. Default `cookie`.
   */
  driver?: 'cookie' | 'memory' | 'file' | 'database' | 'redis'
  /** Directory for the `file` driver (relative to app root; default `storage/framework/sessions`). */
  files?: string
  /** Connection URL for the `redis` driver (default: Bun's REDIS_URL / localhost). */
  redisUrl?: string
  /** Session cookie name. Default `ravel_session`. */
  cookie?: string
  /** Cookie lifetime in seconds. Default 7200 (2h). */
  lifetime?: number
  /** Encryption/signing secret. Defaults to `app.key`. */
  secret?: string
  /** Cookie path. Default `/`. */
  path?: string
  /** Cookie domain. */
  domain?: string
  /** Send the cookie over HTTPS only. Default false (set true in production). */
  secure?: boolean
  /** `HttpOnly` flag on the session cookie. Default true. */
  httpOnly?: boolean
  /** SameSite policy. Default `lax`. */
  sameSite?: 'lax' | 'strict' | 'none'
  /** Expire the cookie when the browser closes (drops max-age). Default false. */
  expireOnClose?: boolean
}

/** Identity helper that pins the type of `config/session.ts` for autocomplete. */
export function defineSessionConfig(config: SessionConfig): SessionConfig {
  return config
}
