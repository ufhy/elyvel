# Logging

Structured, leveled logging with pluggable transports — console for dev,
rotating files in production, all through the same small API. Every HTTP
request is logged automatically with a correlation id, and sensitive fields
are redacted before anything reaches a sink.

## Configuration

The simple form needs no `channels` at all — console plus one optional
rotating file:

```ts
// config/logging.ts
import { defineLoggingConfig } from '@elyvel/core'

export default defineLoggingConfig({
  level: process.env.LOG_LEVEL ?? 'info',
  pretty: process.env.NODE_ENV !== 'production',
  file: 'storage/logs/app.log',
  maxBytes: 5 * 1024 * 1024,
  maxFiles: 5,
})
```

Leave `pretty` unset and the console is human-readable while the file is
JSON, in **every** environment — the logger does not read `APP_ENV`. A log
file outlives the environment that wrote it, and a file holding two formats
is one a log reader gets wrong; pretty text also drops the structured
context that makes entries filterable. To follow the environment anyway,
write it here where you can see it:
`pretty: process.env.APP_ENV !== 'production'` — it applies to both sinks.

For more control, define named channels and combine them into a `stack`
(Laravel's stacked-channel concept):

```ts
export default defineLoggingConfig({
  default: 'stack',
  channels: {
    console: { driver: 'console' },
    daily: { driver: 'daily', path: 'storage/logs/app', maxDays: 30 },
    stack: { driver: 'stack', channels: ['console', 'daily'] },
  },
})
```

`app.logger` is the default channel (or stack); `app.channel('daily')`
resolves a specific one. `http: false` disables the automatic
per-request logging described below.

## Channels

Named sinks, chosen by `default` — the same shape as Laravel's
`config/logging.php`. The framework reads only the config; the scaffolded file is
what consults the environment, through `LOG_*` variables:

```ts
// config/logging.ts
export default defineLoggingConfig({
  default: process.env.LOG_CHANNEL ?? 'stack',
  channels: {
    stack: { driver: 'stack', channels: (process.env.LOG_STACK ?? 'console,single').split(',') },
    console: { driver: 'console' },
    single: { driver: 'file', path: 'storage/logs/app.log', maxBytes: 5 * 1024 * 1024, maxFiles: 5 },
    daily: { driver: 'daily', path: 'storage/logs/app.log', maxDays: 14 },
    null: { driver: 'null' },
  },
})
```

Reach a specific channel with `app.channel('daily')`; `app.logger` uses
`default`. Drivers: `console`, `file`, `daily`, `stack`, and `null`.

`null` accepts writes and discards them — Laravel's NullHandler channel. It is
how `LOG_CHANNEL=null` silences logging without deleting the configuration that
records where logs would otherwise go, and it can sit inside a stack.

### On-demand loggers

A logger described where it's used, rather than in `config/logging.ts` —
Laravel's `Log::build()` and `Log::stack()`:

```ts
// A sink for one job, gone when you drop the reference. Nothing is registered.
app.log.build({ driver: 'file', path: `storage/logs/import-${jobId}.log` })
  .info('started', { rows })

// One write, several existing channels.
app.log.stack(['single', 'daily']).critical('provider unreachable')
```

`build()` inherits the app's level and redaction config, so a one-off file
can't leak what a configured channel would have masked.

## Log levels

The eight RFC 5424 severities PSR-3 defines, which is the set Laravel exposes:

`debug` < `info` < `notice` < `warning` < `error` < `critical` < `alert` <
`emergency`

plus `silent` as a config-only floor that suppresses everything. Each is a
method — `log.critical(...)`, `log.emergency(...)` — and `level` in config is a
threshold, so `level: 'warning'` keeps everything from `warning` upwards.

`warn()` is kept as a spelling of `warning()`: it was the only spelling this
framework had. Entries are always **stored** as `warning`, so filters and the log
viewer never have to match two names for one level.

Everything at `warning` or above is written to stderr, the rest to stdout.

## Writing log messages

```ts
import { createLogger } from '@elyvel/core'

const log = createLogger({ level: 'info' })

log.debug('cache miss', { key })
log.info('user signed up', { userId: user.id })
log.warning('slow query', { ms: 480 })
log.error('payment failed', { orderId, error })
log.critical('payment provider unreachable', { provider })
log.emergency('no database connection available')

// runtime-chosen level
log.log('info', 'checkout started', { cartId })
```

Scope a logger under a name — entries get tagged so you can filter by
subsystem:

```ts
const sql = log.child('sql')
sql.error('query failed', { sql: text, bindings, error })
```

Bind context that should ride along on every subsequent call, instead of
repeating it at each call site:

```ts
const requestLog = log.withContext({ requestId })
requestLog.info('processing') // includes requestId automatically
```

## Transports

| Transport | Behavior |
| --- | --- |
| `console` | Pretty (colorized, human-readable) or JSON-per-line; `error`/`warn` go to `console.error`. |
| `file` | Synchronous writes, size-based rotation (`maxBytes`/`maxFiles`), optional gzip. |
| `file` + `buffered: true` | Batches writes (`flushEvery`/`intervalMs`) into fewer syscalls; flushes on exit/`SIGINT`/`SIGTERM`. |
| `daily` | One file per calendar day (`<path>-YYYY-MM-DD.log`), prunes files older than `maxDays`. |

Each is a concrete, importable class (`ConsoleTransport`, `FileTransport`,
`DailyFileTransport`, `BufferedFileTransport`) implementing a small
`Transport` interface (`log(entry)`) — the config-driven path above builds
one of these for you, but constructing one directly is useful outside a
full app (a standalone script, a custom multi-destination setup):

```ts
import { FileTransport, Logger } from '@elyvel/core'

const log = new Logger({ transports: [new FileTransport('storage/logs/app.log', { compress: true })] })
```

## Redaction

The default redacted key list and value patterns are also exported, if
you want to extend rather than replace them:

```ts
import { DEFAULT_REDACT, REDACT_PATTERNS } from '@elyvel/core'

createLogger({ redact: [...DEFAULT_REDACT, 'ssn'], redactPatterns: [REDACT_PATTERNS.creditCard] })
```

Sensitive fields are scrubbed automatically before an entry reaches any
transport — no per-call-site opt-in needed. Keys matching `password`,
`token`, `authorization`, `secret`, `cookie`, `accessToken`, `refreshToken`,
`apiKey` (case-insensitive) are replaced with `[REDACTED]`, recursively
through nested objects and arrays. Two opt-in value patterns catch secrets
embedded in free text: a credit-card-like digit run, and `Bearer <token>`.

```ts
log.info('login attempt', { email, password: 'hunter2' })
// → { email: '...', password: '[REDACTED]' }
```

Customize the key list or patterns per logger (`createLogger({ redact, redactPatterns })`)
or app-wide (`logging.redact`/`redactPatterns`/`redactJson` in
`config/logging.ts`). `Date`/`RegExp`/`Map`/`Set`/`Error`/typed-array values
pass through untouched rather than being flattened.

## Correlation id & automatic HTTP logging

Every request gets a UUID the moment it arrives, and a `log` bound to it is
available in any handler or middleware — every entry logged through it
automatically carries that request's id:

```ts
route().post('/orders', ({ log, body }) => {
  log.info('creating order', { total: body.total }) // requestId included automatically
})
```

The response itself is logged on the way out — `debug` for a clean 2xx/3xx,
`warn` for 4xx, `error` for 5xx — with `{ requestId, status, ms, userId? }`.
Unhandled 5xx errors get their own entry with the stack trace. Set
`http: false` in `config/logging.ts` to turn this off.

## Cross-package logging

Other packages log into their own named channel automatically when wired.
Two examples: `@elyvel/database`'s `EloquentServiceProvider` logs every
query error to the `sql` channel (and every query at `debug` if
`database.log: true`); `@elyvel/scheduler` logs every scheduled task
failure — including background tasks with no explicit `.onFailure()` — to
the `scheduler` channel, so a silently-failing cron job still leaves a
trace.

## Testing

Inject a fake transport to capture and assert on entries directly, instead
of parsing console/file output:

```ts
import { Logger, type LogEntry } from '@elyvel/core'

const entries: LogEntry[] = []
const log = new Logger({ transports: [{ log: e => entries.push(e) }] })

log.error('boom', { userId: 1 })

expect(entries[0].message).toBe('boom')
expect(entries[0].context).toEqual({ userId: 1 })
```
