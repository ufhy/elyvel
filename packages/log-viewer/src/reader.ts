import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Matches every log file this package understands: the active file,
 * size-rotated (`.log.1`), and daily-rotated (`app-2026-07-19.log`).
 * Gzipped rotations (`FileTransport`'s `compress: true`) aren't read.
 */
const LOG_FILE_RE = /\.log(?:\.\d+)?$/

/** A log file on disk (the active file, or one of its size-rotated siblings). */
export interface LogFileInfo {
  /** Bare filename, e.g. `app.log` or `app.log.1` — the only thing the client ever sends back. */
  name: string
  size: number
  /** Last-modified time, ms since epoch. */
  mtimeMs: number
}

/**
 * A single log entry. In JSON mode every context field is its own key. In
 * pretty/text mode (`FileTransport`'s `pretty: true`) the framework only
 * writes `time`/`level`/`name`/`message` as real fields — everything else
 * (short context, a stack trace) is NOT re-parsed into structured data (it
 * can't be, safely — see the module doc comment) and instead comes back
 * verbatim as `_raw`, to render as-is.
 */
export interface LogEntry {
  time?: string
  level?: string
  name?: string
  message?: string
  _raw?: string
  [key: string]: unknown
}

export interface EntryQuery {
  /** Only entries at this level. */
  level?: string
  /** Case-insensitive substring match against the entry's original text. */
  q?: string
  page?: number
  perPage?: number
  /** `desc` (newest first, the default) or `asc`. */
  direction?: 'asc' | 'desc'
}

export interface EntryPage {
  entries: LogEntry[]
  total: number
  page: number
  perPage: number
}

/** Resolves `name` inside `dir`, rejecting anything that would escape it (`..`, absolute paths). */
export function resolveLogFile(dir: string, name: string): string | undefined {
  const target = resolve(dir, name)
  const base = resolve(dir)
  if (target !== base && !target.startsWith(`${base}/`))
    return undefined
  return target
}

/** Every log file in `dir` (active, size/daily-rotated), newest first. Missing directory → empty list. */
export function listLogFiles(dir: string): LogFileInfo[] {
  if (!existsSync(dir))
    return []
  return readdirSync(dir)
    .filter(f => LOG_FILE_RE.test(f))
    .map((name) => {
      const stat = statSync(join(dir, name))
      return { name, size: stat.size, mtimeMs: stat.mtimeMs }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
}

interface Parsed { entry: LogEntry, searchText: string }

/** A line that is itself a complete JSON object (`FileTransport`'s default, `pretty: false`). */
function parseJsonLine(line: string): LogEntry | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{'))
    return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed))
      return parsed as LogEntry
  }
  catch {
    // Not a complete JSON object — fall through and treat it as text.
  }
  return undefined
}

/**
 * Matches a pretty-mode header line — `formatEntry()`'s non-colored output:
 * `{time} {LEVEL}[ ({name})] {message}`. Anything that ISN'T a header line
 * belongs to the entry above it (a `key=value` context summary, or a stack
 * trace — both may contain real newlines, so they can't be parsed back into
 * structured fields; they're kept as one raw block instead). This mirrors
 * how opcodesio/log-viewer reads Laravel's own (Monolog) text format: detect
 * a new entry by its header, greedily absorb everything until the next one.
 */
// All eight PSR-3 severities, plus the legacy `WARN` spelling so files written
// before `warning` existed keep parsing.
const HEADER_RE = /^(\S+) (DEBUG|INFO|NOTICE|WARNING|WARN|ERROR|CRITICAL|ALERT|EMERGENCY) (?:\(([^)]*)\) )?(.*)$/

/**
 * Classifies every line on its own, rather than picking one mode for the whole
 * file. A file can legitimately contain both: `pretty` is typically on in dev and
 * off in production, and both write to the same path — so `bun run dev` followed
 * by `bun run start` leaves pretty lines above JSON lines in one file.
 *
 * Deciding from the first line alone (what this used to do) made every later line
 * of the other format invisible: JSON lines don't match `HEADER_RE`, so they were
 * absorbed as continuation text into whichever pretty entry came last — 47 real
 * entries collapsed into one entry's `_raw` block, with nothing in the UI to
 * suggest anything was missing.
 */
function parseFile(content: string): Parsed[] {
  const out: Parsed[] = []
  let current: { entry: LogEntry, searchLines: string[], rawLines: string[] } | undefined

  const flush = () => {
    if (!current)
      return
    if (current.rawLines.length > 0)
      current.entry._raw = current.rawLines.join('\n')
    out.push({ entry: current.entry, searchText: current.searchLines.join('\n') })
    current = undefined
  }

  for (const line of content.split('\n')) {
    const json = parseJsonLine(line)
    if (json) {
      flush()
      out.push({ entry: json, searchText: line })
      continue
    }

    const match = line.match(HEADER_RE)
    if (match) {
      flush()
      const [, time, level, name, message] = match
      current = { entry: { time, level: level!.toLowerCase(), name, message }, searchLines: [line], rawLines: [] }
    }
    else if (current && line.trim() !== '') {
      current.searchLines.push(line)
      current.rawLines.push(line)
    }
  }
  flush()
  return out
}

/**
 * Reads, filters, and paginates entries from one log file. Loads the whole
 * file into memory — fine at the default 5MB-per-file rotation size; a much
 * larger `maxBytes` will make this slower (there's no on-disk index, unlike
 * opcodesio/log-viewer's Laravel equivalent).
 */
export function readEntries(path: string, query: EntryQuery = {}): EntryPage {
  const page = Math.max(1, query.page ?? 1)
  const perPage = Math.max(1, query.perPage ?? 50)
  const direction = query.direction ?? 'desc'
  const q = query.q?.toLowerCase()
  const level = query.level?.toLowerCase()

  const content = existsSync(path) ? readFileSync(path, 'utf8') : ''
  let parsed = parseFile(content)
    .filter(({ entry }) => !level || entry.level?.toLowerCase() === level)
    .filter(({ searchText }) => !q || searchText.toLowerCase().includes(q))

  if (direction === 'desc')
    parsed = parsed.reverse()

  const total = parsed.length
  const start = (page - 1) * perPage
  return {
    entries: parsed.slice(start, start + perPage).map(p => p.entry),
    total,
    page,
    perPage,
  }
}

/** Deletes a log file. Caller is responsible for resolving/validating the path first. */
export function deleteLogFile(path: string): void {
  if (existsSync(path))
    unlinkSync(path)
}
