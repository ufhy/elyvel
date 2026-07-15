import { REDACT_PATTERNS, defineLoggingConfig } from '@elysia-ravel/core'

/**
 * Logging config.
 * - `level`   — minimum level to emit (debug|info|warn|error|silent)
 * - `pretty`  — colorized console (dev) vs. JSON (prod); default per env
 * - `http`    — log every HTTP request/response with a correlation id
 * - `default` — the channel (or `stack`) used by `app.logger`
 * - `channels`— named sinks; `app.channel('daily')` targets one directly
 */
export default defineLoggingConfig({
  level: 'info',
  pretty: (process.env.APP_ENV ?? 'local') !== 'production',
  http: true,

  default: 'stack',
  channels: {
    console: { driver: 'console' },
    file: {
      driver: 'file',
      path: 'storage/logs/app.log',
      maxBytes: 5 * 1024 * 1024,
      maxFiles: 5,
      // Rotated files stay plain text so you can open/grep them directly.
      // Set `compress: true` only if you're disk-constrained (reads then need zcat/zless).
    },
    daily: { driver: 'daily', path: 'storage/logs/app', maxDays: 14 },
    stack: { driver: 'stack', channels: ['console', 'file', 'daily'] },
  },

  // Mask `Bearer <token>` anywhere in string values (keys are always redacted).
  redactPatterns: [REDACT_PATTERNS.bearer.source],
  // Also redact sensitive keys inside stringified-JSON payloads.
  redactJson: true,
})
