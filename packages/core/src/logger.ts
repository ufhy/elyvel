import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { token } from './container'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent'

const WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
}

export type LeveledLevel = Exclude<LogLevel, 'silent'>

export interface LogEntry {
  time: string
  level: LeveledLevel
  name?: string
  message: string
  /** Already merged (bindings + call context) and redacted. */
  context?: Record<string, unknown>
}

/** A sink that receives fully-formed log entries. */
export interface Transport {
  log(entry: LogEntry): void
  /** Optional: flush any buffered writes (called on process exit). */
  flush?(): void
}

// ── Redaction ────────────────────────────────────────────────────────────────

const REDACTED = '[REDACTED]'

/** Default keys whose values are masked anywhere in a log context. */
export const DEFAULT_REDACT = [
  'password',
  'token',
  'authorization',
  'secret',
  'cookie',
  'accesstoken',
  'refreshtoken',
  'apikey',
]

/** Ready-made value patterns you can opt into via `redactPatterns`. */
export const REDACT_PATTERNS = {
  /** 13–16 digit sequences (credit-card-like). */
  creditCard: /\b(?:\d[ -]?){13,16}\b/g,
  /** `Bearer <token>` occurrences in free text. */
  bearer: /Bearer\s+[\w.-]+/gi,
}

function maskPatterns(value: string, patterns: RegExp[]): string {
  return patterns.reduce((acc, pattern) => acc.replace(pattern, REDACTED), value)
}

interface RedactConfig {
  keys: Set<string>
  patterns: RegExp[]
  /** Also parse JSON-looking strings, redact inside, and re-stringify. */
  json: boolean
}

/**
 * Recursively mask values by key (case-insensitive), by string pattern, and
 *  optionally inside stringified JSON.
 */
function redact(value: unknown, cfg: RedactConfig): unknown {
  if (typeof value === 'string') {
    if (cfg.json) {
      const trimmed = value.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(value)
          if (parsed && typeof parsed === 'object') {
            return JSON.stringify(redact(parsed, cfg))
          }
        }
        catch {
          // not JSON — fall through to pattern masking
        }
      }
    }
    return cfg.patterns.length ? maskPatterns(value, cfg.patterns) : value
  }
  if (Array.isArray(value))
    return value.map(v => redact(v, cfg))
  if (
    value !== null
    && typeof value === 'object'
    // These carry their data outside enumerable own properties — walking
    // Object.entries() on them returns nothing and would silently replace
    // them with `{}`, losing the value entirely. Pass them through as-is.
    && !(value instanceof Date || value instanceof RegExp || value instanceof Map || value instanceof Set || value instanceof Error || ArrayBuffer.isView(value))
  ) {
    // Not just plain `{}` object literals — any class instance (e.g. an ORM
    // model carrying a `password`/`token` field) is walked the same way, so
    // logging a model instance directly still redacts its sensitive fields
    // instead of dumping them unredacted via its enumerable own properties.
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = cfg.keys.has(k.toLowerCase()) ? REDACTED : redact(v, cfg)
    }
    return out
  }
  return value
}

/** Flatten an entry to a record, with reserved fields always taking precedence. */
function flatten(entry: LogEntry): Record<string, unknown> {
  const { time, level, name, message, context } = entry
  return { ...context, time, level, name, message }
}

// ── Transports ───────────────────────────────────────────────────────────────

const COLORS: Record<LeveledLevel, string> = {
  debug: '\x1B[90m',
  info: '\x1B[36m',
  warn: '\x1B[33m',
  error: '\x1B[31m',
}
const RESET = '\x1B[0m'

/**
 * A human-readable rendering of an entry — one summary line, then a `key=value`
 * line for short context fields, then `stack` (if present) as genuine indented
 * multi-line text rather than an escaped `\n`-riddled JSON string. Used by
 * {@link ConsoleTransport} (colorized) and any file transport with `pretty: true`
 * (plain — a stack trace with ANSI codes in a text editor is its own kind of
 * unreadable).
 */
function formatEntry(entry: LogEntry, colors: boolean): string {
  const time = colors ? `\x1B[90m${entry.time}${RESET}` : entry.time
  const level = colors ? `${COLORS[entry.level]}${entry.level.toUpperCase()}${RESET}` : entry.level.toUpperCase()
  const scope = entry.name ? (colors ? ` \x1B[35m(${entry.name})${RESET}` : ` (${entry.name})`) : ''
  const lines = [`${time} ${level}${scope} ${entry.message}`]

  if (entry.context) {
    const { stack, ...rest } = entry.context as { stack?: unknown } & Record<string, unknown>
    const fields = Object.entries(rest)
    if (fields.length > 0) {
      lines.push(`  ${fields.map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' ')}`)
    }
    if (typeof stack === 'string') {
      lines.push('  stack:')
      for (const stackLine of stack.split('\n')) lines.push(`    ${stackLine}`)
    }
  }
  return lines.join('\n')
}

/** Writes to the console: human-readable lines (pretty) or one JSON object per line. */
export class ConsoleTransport implements Transport {
  constructor(private readonly pretty = true) {}

  log(entry: LogEntry): void {
    const line = this.pretty ? formatEntry(entry, true) : JSON.stringify(flatten(entry))
    if (entry.level === 'error' || entry.level === 'warn')
      console.error(line)
    else console.log(line)
  }
}

/**
 * Rotate `path` by size, shifting path.1 … path.N and dropping the oldest.
 * When `compress`, the freshly rotated file is gzipped (`path.1.gz`).
 */
function rotateBySize(
  path: string,
  incoming: number,
  maxBytes: number,
  maxFiles: number,
  compress: boolean,
): void {
  if (!existsSync(path))
    return
  if (statSync(path).size + incoming < maxBytes)
    return

  const ext = compress ? '.gz' : ''
  for (let i = maxFiles - 1; i >= 1; i--) {
    const from = `${path}.${i}${ext}`
    // Rename and treat "it wasn't there" as normal, rather than checking first.
    // `existsSync` then `renameSync` is a race: two processes sharing a log
    // volume (a rolling deploy on one mount) can both pass the check, and the
    // loser threw ENOENT out of the middle of a log write.
    try {
      renameSync(from, `${path}.${i + 1}${ext}`)
    }
    catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT')
        throw error
    }
  }

  if (compress) {
    writeFileSync(`${path}.1.gz`, gzipSync(readFileSync(path)))
    rmSync(path)
  }
  else {
    renameSync(path, `${path}.1`)
  }
}

export interface FileTransportOptions {
  /** Rotate once the active file reaches this size. Default 5 MiB. */
  maxBytes?: number
  /** Number of rotated files to keep (app.log.1 … app.log.N). Default 5. */
  maxFiles?: number
  /** Gzip rotated files. Default false. */
  compress?: boolean
  /**
   * Human-readable lines (summary + `key=value` + a genuinely multi-line
   * stack trace) instead of one dense JSON object per line. Default false —
   * flip it on for a file a developer will actually open and read (local/dev);
   * leave it off for a file a log aggregator (Datadog, CloudWatch, `jq`…) will
   * parse (production).
   */
  pretty?: boolean
}

function renderLine(entry: LogEntry, pretty: boolean): string {
  return pretty ? formatEntry(entry, false) : JSON.stringify(flatten(entry))
}

/**
 * Appends log lines to a file, rotating by size. Writes are synchronous for
 * durability (a crash loses at most the in-flight line).
 */
export class FileTransport implements Transport {
  private readonly maxBytes: number
  private readonly maxFiles: number
  private readonly compress: boolean
  private readonly pretty: boolean

  constructor(
    private readonly path: string,
    options: FileTransportOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024
    this.maxFiles = options.maxFiles ?? 5
    this.compress = options.compress ?? false
    this.pretty = options.pretty ?? false
    mkdirSync(dirname(path), { recursive: true })
  }

  log(entry: LogEntry): void {
    const line = `${renderLine(entry, this.pretty)}\n`
    rotateBySize(this.path, Buffer.byteLength(line), this.maxBytes, this.maxFiles, this.compress)
    appendFileSync(this.path, line)
  }
}

export interface BufferedFileTransportOptions extends FileTransportOptions {
  /** Flush after this many buffered lines. Default 50. */
  flushEvery?: number
  /** Flush at most this often (ms) when idle. Default 1000. */
  intervalMs?: number
}

/**
 * Like {@link FileTransport} but batches lines and writes them in one syscall,
 * trading a little durability for far fewer writes under load. Flushes on a
 * size threshold, an idle timer, and process exit.
 */
export class BufferedFileTransport implements Transport {
  private readonly maxBytes: number
  private readonly maxFiles: number
  private readonly compress: boolean
  private readonly pretty: boolean
  private readonly flushEvery: number
  private readonly intervalMs: number
  private buffer: string[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly path: string,
    options: BufferedFileTransportOptions = {},
  ) {
    this.maxBytes = options.maxBytes ?? 5 * 1024 * 1024
    this.maxFiles = options.maxFiles ?? 5
    this.compress = options.compress ?? false
    this.pretty = options.pretty ?? false
    this.flushEvery = options.flushEvery ?? 50
    this.intervalMs = options.intervalMs ?? 1000
    mkdirSync(dirname(path), { recursive: true })
    process.on('exit', () => this.flush())
    process.on('beforeExit', () => this.flush())
    // Graceful shutdown: flush buffered lines before the signal terminates us.
    const flushAndExit = (signal: NodeJS.Signals) => {
      this.flush()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    }
    process.once('SIGINT', flushAndExit)
    process.once('SIGTERM', flushAndExit)
  }

  log(entry: LogEntry): void {
    this.buffer.push(`${renderLine(entry, this.pretty)}\n`)
    if (this.buffer.length >= this.flushEvery)
      this.flush()
    else this.schedule()
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.buffer.length === 0)
      return
    const payload = this.buffer.join('')
    try {
      rotateBySize(this.path, Buffer.byteLength(payload), this.maxBytes, this.maxFiles, this.compress)
      appendFileSync(this.path, payload)
      this.buffer = []
    }
    catch (error) {
      // Don't clear the buffer on failure — a transient write error (ENOSPC, a
      // permission blip, rotation's renameSync throwing) used to silently drop
      // up to `flushEvery` lines with no trace anywhere. Keep them so the next
      // flush() retries, but cap growth so a persistently broken disk doesn't
      // leak memory forever.
      console.error('[elyvel] buffered file transport flush failed, will retry:', error)
      if (this.buffer.length > this.flushEvery * 10) {
        console.error(`[elyvel] dropping ${this.buffer.length} buffered log lines after repeated flush failures`)
        console.error(payload)
        this.buffer = []
      }
    }
  }

  private schedule(): void {
    if (this.timer)
      return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.intervalMs)
    // Don't keep the event loop alive just for a pending flush.
    if (typeof this.timer === 'object' && 'unref' in this.timer)
      this.timer.unref()
  }
}

export interface DailyFileTransportOptions {
  /** Days of history to keep. Older files are pruned. Default 14. */
  maxDays?: number
  /** Human-readable lines instead of JSON — see {@link FileTransportOptions.pretty}. */
  pretty?: boolean
}

/**
 * Writes to a per-day file (`<base>-YYYY-MM-DD.log`) and prunes files older
 * than `maxDays`. Rotation is by calendar day rather than size.
 */
export class DailyFileTransport implements Transport {
  private readonly dir: string
  private readonly base: string
  private readonly maxDays: number
  private readonly pretty: boolean
  private lastDay = ''

  /** @param pathBase e.g. `storage/logs/app` → `storage/logs/app-2026-07-11.log` */
  constructor(pathBase: string, options: DailyFileTransportOptions = {}) {
    this.dir = dirname(pathBase)
    this.base = basename(pathBase)
    this.maxDays = options.maxDays ?? 14
    this.pretty = options.pretty ?? false
    mkdirSync(this.dir, { recursive: true })
  }

  log(entry: LogEntry): void {
    const day = entry.time.slice(0, 10) // YYYY-MM-DD
    if (day !== this.lastDay) {
      this.lastDay = day
      this.prune()
    }
    appendFileSync(join(this.dir, `${this.base}-${day}.log`), `${renderLine(entry, this.pretty)}\n`)
  }

  private prune(): void {
    const prefix = `${this.base}-`
    const files = readdirSync(this.dir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.log'))
      .sort()
    for (const file of files.slice(0, Math.max(0, files.length - this.maxDays))) {
      rmSync(join(this.dir, file), { force: true })
    }
  }
}

// ── Logger ─────────────────────────────────────────────────────────────────

export interface LoggerOptions {
  /** Minimum level to emit. Anything below is dropped. */
  level?: LogLevel
  /** Scope label, e.g. a subsystem name. */
  name?: string
  /** Sinks to write to. Defaults to a single pretty console transport. */
  transports?: Transport[]
  /** Context merged into every entry (e.g. a request id). */
  bindings?: Record<string, unknown>
  /** Keys to mask in context (case-insensitive). Defaults to {@link DEFAULT_REDACT}. */
  redact?: string[]
  /** Regex patterns to mask within string values. Default none. */
  redactPatterns?: RegExp[]
  /** Also redact inside stringified-JSON string values. Default false. */
  redactJson?: boolean
}

/**
 * A tiny leveled logger fanning out to one or more {@link Transport}s. Supports
 * scoped children ({@link Logger.child}), bound context
 * ({@link Logger.withBindings}), and redaction of sensitive keys and patterns.
 */
export class Logger {
  private readonly level: LogLevel
  private readonly name?: string
  private readonly transports: Transport[]
  private readonly bindings: Record<string, unknown>
  private readonly redactCfg: RedactConfig

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info'
    this.name = options.name
    this.transports = options.transports ?? [new ConsoleTransport(true)]
    this.bindings = options.bindings ?? {}
    this.redactCfg = {
      keys: new Set((options.redact ?? DEFAULT_REDACT).map(k => k.toLowerCase())),
      patterns: options.redactPatterns ?? [],
      json: options.redactJson ?? false,
    }
  }

  private clone(overrides: Partial<LoggerOptions>): Logger {
    return new Logger({
      level: this.level,
      name: this.name,
      transports: this.transports,
      bindings: this.bindings,
      redact: [...this.redactCfg.keys],
      redactPatterns: this.redactCfg.patterns,
      redactJson: this.redactCfg.json,
      ...overrides,
    })
  }

  /** Derive a child logger with an additional scope name. */
  child(name: string): Logger {
    return this.clone({ name: this.name ? `${this.name}:${name}` : name })
  }

  /** Derive a logger that merges `bindings` into every entry (e.g. a request id). */
  withBindings(bindings: Record<string, unknown>): Logger {
    return this.clone({ bindings: { ...this.bindings, ...bindings } })
  }

  /** Alias of {@link withBindings} (Laravel naming: contextual info on every entry). */
  withContext(context: Record<string, unknown>): Logger {
    return this.withBindings(context)
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.write('debug', message, context)
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.write('info', message, context)
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.write('warn', message, context)
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.write('error', message, context)
  }

  /** Log at a level chosen at runtime. */
  log(level: LeveledLevel, message: string, context?: Record<string, unknown>): void {
    this.write(level, message, context)
  }

  private write(level: LeveledLevel, message: string, context?: Record<string, unknown>): void {
    if (WEIGHT[level] < WEIGHT[this.level])
      return

    const merged = { ...this.bindings, ...context }
    const safe = redact(merged, this.redactCfg) as Record<string, unknown>
    const entry: LogEntry = {
      time: new Date().toISOString(),
      level,
      name: this.name,
      message,
      context: Object.keys(safe).length ? safe : undefined,
    }
    for (const transport of this.transports) {
      try {
        transport.log(entry)
      }
      catch (error) {
        // A transport failing (disk full, permission denied, network down for a
        // remote sink…) must never crash the request it's trying to observe —
        // including when this write is itself happening inside an onError
        // handler. Fall back to stderr so the entry (and the failure) still
        // surface somewhere, à la Laravel's last-resort `emergency` channel.
        console.error('[elyvel] log transport failed:', error)
        console.error(JSON.stringify(entry))
      }
    }
  }
}

export interface CreateLoggerOptions extends LoggerOptions {
  /** When no explicit transports are given, whether the console is colorized. */
  pretty?: boolean
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const transports = options.transports ?? [new ConsoleTransport(options.pretty ?? true)]
  return new Logger({
    level: options.level,
    name: options.name,
    transports,
    bindings: options.bindings,
    redact: options.redact,
    redactPatterns: options.redactPatterns,
    redactJson: options.redactJson,
  })
}

// ── Channels ─────────────────────────────────────────────────────────────────

/**
 * Holds named log channels (each a {@link Logger}) plus a default channel used
 * by `app.logger`. Mirrors Laravel's channel/stack concept: `channel('daily')`
 * targets one sink, the default may be a stack of several.
 */
export class LogManager {
  constructor(
    private readonly channels: Map<string, Logger>,
    private readonly defaultLogger: Logger,
  ) {}

  /** The default logger (a single channel or a stack). */
  get default(): Logger {
    return this.defaultLogger
  }

  /** Resolve a named channel, throwing if it is not configured. */
  channel(name: string): Logger {
    const logger = this.channels.get(name)
    if (!logger) {
      throw new Error(
        `[elyvel] Log channel "${name}" is not defined. Available: ${[...this.channels.keys()].join(', ')}`,
      )
    }
    return logger
  }
}

export const LoggerToken = token<Logger>('logger')
export const LogManagerToken = token<LogManager>('log.manager')

/**
 * A single logging channel definition (used in `config/logging.ts`).
 * Discriminated by `driver` so editors autocomplete the right fields.
 */
export type LogChannelConfig
  = | { driver: 'console', level?: LogLevel, pretty?: boolean }
    | {
      driver: 'file'
      level?: LogLevel
      path: string
      maxBytes?: number
      maxFiles?: number
      buffered?: boolean
      compress?: boolean
      pretty?: boolean
    }
    | { driver: 'daily', level?: LogLevel, path: string, maxDays?: number, pretty?: boolean }
    | { driver: 'stack', level?: LogLevel, channels?: string[] }
