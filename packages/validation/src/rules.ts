import type { SizeKind } from './messages'
import { countWithTimeout } from './db-rules'
import { sniffFileMime } from './file-inspect'
import { readImageDimensions, sniffImageMime } from './image-inspect'

export type Data = Record<string, unknown>
export type RuleFn = (
  value: unknown,
  args: string[],
  data: Data,
  attribute: string,
  kind: SizeKind,
) => boolean | Promise<boolean>

export interface Rule {
  validate: RuleFn
  /** Implicit rules run even when the value is empty/absent (e.g. `required`). */
  implicit?: boolean
}

export function isEmpty(value: unknown): boolean {
  return (
    value === undefined
    || value === null
    // Whitespace-only counts as empty, matching Laravel — otherwise `'   '`
    // satisfies `required`. (The TrimStrings middleware hides this on HTTP
    // paths, but not for a Validator called directly.)
    || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0)
  )
}

// `accepted`/`declined` take the broad web-form set ("yes"/"on"/…), matching
// Laravel. The `boolean` rule is stricter — see BOOLEAN below.
const TRUTHY = new Set([true, 1, '1', 'yes', 'on', 'true'])
const FALSY = new Set([false, 0, '0', 'no', 'off', 'false'])
// Laravel's `boolean` rule accepts only these — NOT 'yes'/'on'/'true' etc.
const BOOLEAN = new Set([true, false, 1, 0, '1', '0'])
const EMAIL = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/
const IPV6 = /^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i
const MAC = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/** IPv4 with real octet ranges — the shape regex alone accepts `999.999.999.999`. */
function isIpv4(value: string): boolean {
  if (!IPV4.test(value))
    return false
  return value.split('.').every(octet => Number(octet) <= 255)
}

function isFile(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

/** A MIME type `sniffFileMime` can actually verify from content (images + PDF). */
function isSniffableMime(type: string): boolean {
  return type.startsWith('image/') || type === 'application/pdf'
}

interface DimensionConstraints {
  width?: number
  height?: number
  minWidth?: number
  maxWidth?: number
  minHeight?: number
  maxHeight?: number
  ratio?: number
}

/** `3/2` or a plain decimal like `1.5` — both are valid `ratio=` values. */
function parseRatio(value: string): number {
  if (value.includes('/')) {
    const [w, h] = value.split('/')
    return Number(w) / Number(h)
  }
  return Number(value)
}

const DIMENSION_KEYS: Record<string, keyof DimensionConstraints> = {
  width: 'width',
  height: 'height',
  min_width: 'minWidth',
  max_width: 'maxWidth',
  min_height: 'minHeight',
  max_height: 'maxHeight',
}

/** Parses `dimensions:min_width=200,ratio=16/9`-style `key=value` args. */
function parseDimensionArgs(args: string[]): DimensionConstraints {
  const out: DimensionConstraints = {}
  for (const arg of args) {
    const idx = arg.indexOf('=')
    if (idx === -1)
      continue
    const key = arg.slice(0, idx)
    const value = arg.slice(idx + 1)
    if (key === 'ratio')
      out.ratio = parseRatio(value)
    else if (DIMENSION_KEYS[key])
      out[DIMENSION_KEYS[key]] = Number(value)
  }
  return out
}

/**
 * The magnitude `min`/`max`/`size`/`between` compare against.
 *
 * A file or an array carries its own notion of size, so the VALUE decides for
 * those — `kind` is inferred from rule NAMES only, so `max:1024` without an
 * explicit `file`/`image` fell through to `String(value).length`, which is 13
 * for any Blob (`'[object Blob]'`). Every upload passed every size limit.
 * `numeric` still needs the rule, since only the caller can say whether `'5'`
 * means the number 5 or a 1-character string.
 */
function size(value: unknown, kind: SizeKind): number {
  if (isFile(value))
    return value.size / 1024 // KB
  if (Array.isArray(value))
    return value.length
  if (kind === 'numeric')
    return Number(value)
  // Declared as a file/array but isn't one — 0 rather than a string length, so
  // the accompanying type rule reports the real problem.
  if (kind === 'file' || kind === 'array')
    return 0
  return String(value).length
}

/**
 * Read a (possibly dotted) path out of the data. Every rule that names ANOTHER
 * field — `required_if:addr.country,ID`, `same:user.password`, `lte:limits.max`
 * — must resolve it this way. A flat `data[arg]` lookup returns `undefined` for
 * any dotted name, which silently made those rules no-ops: the condition never
 * matched, so the requirement never fired and invalid input passed. `attribute`
 * is itself an expanded path (`user.role`, `items.0.q`), so self-referencing
 * rules need this too.
 */
export function getValue(data: unknown, path: string): unknown {
  if (path === '')
    return data
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined)
      return undefined
    return (acc as Record<string, unknown>)[key]
  }, data)
}

/** Whether a (possibly dotted) path is actually present, distinguishing "absent" from "set to undefined". */
export function hasPath(data: unknown, path: string): boolean {
  const segments = path.split('.')
  let acc: unknown = data
  for (const key of segments) {
    if (acc === null || typeof acc !== 'object' || !(key in (acc as object)))
      return false
    acc = (acc as Record<string, unknown>)[key]
  }
  return true
}

/**
 * `field,val1,val2,…` conditional rules match when the other field equals ANY
 * listed value (Laravel semantics) — the buggy original only tested the first.
 */
function otherFieldMatches(args: string[], data: Data): boolean {
  const other = String(getValue(data, args[0] as string))
  return args.slice(1).includes(other)
}

// Standard decimal / scientific notation only. Excludes what `Number()` would
// otherwise silently accept: hex (`0x10`), binary/octal (`0b..`/`0o..`),
// `Infinity`, `NaN` — none of which PHP's `is_numeric` treats as numeric.
const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i

function isNumeric(value: unknown): boolean {
  if (typeof value === 'number')
    return Number.isFinite(value)
  if (typeof value !== 'string')
    return false
  const s = value.trim()
  return s !== '' && NUMERIC.test(s) && Number.isFinite(Number(s))
}

function compareTo(arg: string | undefined, data: Data): number {
  if (arg !== undefined && hasPath(data, arg))
    return Number(getValue(data, arg))
  return Number(arg)
}

/** Value of another field for date comparisons (a field name resolves to its value). */
function dateArg(arg: string | undefined, data: Data): number {
  if (arg !== undefined && hasPath(data, arg))
    return Date.parse(String(getValue(data, arg)))
  return Date.parse(String(arg))
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
}

const DATE_TOKEN_WIDTH: Record<string, number> = { Y: 4, m: 2, d: 2, H: 2, i: 2, s: 2 }

/**
 * Whether `value` matches the PHP-style `format` (subset: Y m d H i s) AND is a
 * real calendar date — not just the right shape. So `2020-13-45` / `2021-02-29`
 * are rejected (month/day out of range), matching Laravel's `createFromFormat`
 * validity check rather than a bare digit-count regex.
 */
function matchesDateFormat(value: string, format: string): boolean {
  const fields: Record<string, number> = {}
  let vi = 0
  for (let fi = 0; fi < format.length; fi++) {
    const token = format[fi] as string
    const width = DATE_TOKEN_WIDTH[token]
    if (width !== undefined) {
      const slice = value.slice(vi, vi + width)
      if (slice.length !== width || !/^\d+$/.test(slice))
        return false
      fields[token] = Number(slice)
      vi += width
    }
    else {
      if (value[vi] !== token)
        return false
      vi += 1
    }
  }
  if (vi !== value.length)
    return false // trailing characters beyond the format
  if (fields.m !== undefined && (fields.m < 1 || fields.m > 12))
    return false
  if (fields.H !== undefined && fields.H > 23)
    return false
  if (fields.i !== undefined && fields.i > 59)
    return false
  if (fields.s !== undefined && fields.s > 59)
    return false
  if (fields.d !== undefined) {
    const year = fields.Y ?? 2000 // leap-year default when no year in the format
    const month = fields.m ?? 1
    const daysInMonth = new Date(year, month, 0).getDate()
    if (fields.d < 1 || fields.d > daysInMonth)
      return false
  }
  return true
}

export const RULES: Record<string, Rule> = {
  // presence
  required: { implicit: true, validate: v => !isEmpty(v) },
  present: { implicit: true, validate: (_v, _a, data, attr) => hasPath(data, attr) },
  filled: { implicit: true, validate: (v, _a, data, attr) => !hasPath(data, attr) || !isEmpty(v) },
  nullable: { implicit: true, validate: () => true },
  sometimes: { implicit: true, validate: () => true },

  // conditional presence
  required_if: {
    implicit: true,
    validate: (v, args, data) => (otherFieldMatches(args, data) ? !isEmpty(v) : true),
  },
  required_unless: {
    implicit: true,
    validate: (v, args, data) => (otherFieldMatches(args, data) ? true : !isEmpty(v)),
  },
  required_with: {
    implicit: true,
    validate: (v, args, data) => (args.some(f => !isEmpty(getValue(data, f))) ? !isEmpty(v) : true),
  },
  required_with_all: {
    implicit: true,
    validate: (v, args, data) => (args.every(f => !isEmpty(getValue(data, f))) ? !isEmpty(v) : true),
  },
  required_without: {
    implicit: true,
    validate: (v, args, data) => (args.some(f => isEmpty(getValue(data, f))) ? !isEmpty(v) : true),
  },
  required_without_all: {
    implicit: true,
    validate: (v, args, data) => (args.every(f => isEmpty(getValue(data, f))) ? !isEmpty(v) : true),
  },
  prohibited: { implicit: true, validate: v => isEmpty(v) },
  prohibited_if: {
    implicit: true,
    validate: (v, args, data) => (otherFieldMatches(args, data) ? isEmpty(v) : true),
  },
  prohibited_unless: {
    implicit: true,
    validate: (v, args, data) => (otherFieldMatches(args, data) ? true : isEmpty(v)),
  },
  missing: { implicit: true, validate: (_v, _a, data, attr) => !hasPath(data, attr) },
  missing_if: {
    implicit: true,
    validate: (_v, args, data, attr) => (otherFieldMatches(args, data) ? !hasPath(data, attr) : true),
  },
  missing_with: {
    implicit: true,
    validate: (_v, args, data, attr) => (args.some(f => hasPath(data, f)) ? !hasPath(data, attr) : true),
  },
  accepted: { implicit: true, validate: v => TRUTHY.has(v as never) },
  accepted_if: {
    implicit: true,
    validate: (v, args, data) => (otherFieldMatches(args, data) ? TRUTHY.has(v as never) : true),
  },
  declined: { implicit: true, validate: v => FALSY.has(v as never) },
  declined_if: {
    implicit: true,
    validate: (v, args, data) => (otherFieldMatches(args, data) ? FALSY.has(v as never) : true),
  },

  // types
  string: { validate: v => typeof v === 'string' },
  integer: { validate: v => isNumeric(v) && Number.isInteger(Number(v)) },
  numeric: { validate: v => isNumeric(v) },
  boolean: { validate: v => BOOLEAN.has(v as never) },
  array: {
    validate: (v, args) => {
      if (args.length === 0)
        return Array.isArray(v)
      if (v === null || typeof v !== 'object' || Array.isArray(v))
        return false
      return Object.keys(v).every(k => args.includes(k))
    },
  },

  // formats
  email: { validate: v => EMAIL.test(String(v)) },
  url: {
    // http(s) only. `URL.canParse` happily accepts `javascript:alert(1)` and
    // `data:` URLs — exactly what must not reach an href/src after passing
    // "validation". Laravel restricts the scheme for the same reason.
    validate: (v) => {
      try {
        const { protocol } = new URL(String(v))
        return protocol === 'http:' || protocol === 'https:'
      }
      catch {
        return false
      }
    },
  },
  uuid: { validate: v => UUID.test(String(v)) },
  ulid: { validate: v => ULID.test(String(v)) },
  ip: { validate: v => isIpv4(String(v)) || IPV6.test(String(v)) },
  mac_address: { validate: v => MAC.test(String(v)) },
  hex_color: { validate: v => HEX_COLOR.test(String(v)) },
  json: {
    validate: (v) => {
      try {
        JSON.parse(String(v))
        return true
      }
      catch {
        return false
      }
    },
  },
  timezone: {
    validate: (v) => {
      try {
        // eslint-disable-next-line no-new -- constructing throws on an invalid time zone
        new Intl.DateTimeFormat(undefined, { timeZone: String(v) })
        return true
      }
      catch {
        return false
      }
    },
  },
  // Unicode letters by default, matching Laravel (which rejects 'José' from
  // `alpha` only with the opt-in `alpha:ascii`). Use the `ascii` rule for the
  // ASCII-only variant.
  alpha: { validate: v => /^[\p{L}\p{M}]+$/u.test(String(v)) },
  alpha_num: { validate: v => /^[\p{L}\p{M}\p{N}]+$/u.test(String(v)) },
  alpha_dash: { validate: v => /^[\p{L}\p{M}\p{N}_-]+$/u.test(String(v)) },
  // eslint-disable-next-line no-control-regex -- the ascii rule validates the full ASCII range \x00-\x7F
  ascii: { validate: v => /^[\x00-\x7F]*$/.test(String(v)) },
  uppercase: { validate: v => String(v) === String(v).toUpperCase() },
  lowercase: { validate: v => String(v) === String(v).toLowerCase() },

  // membership / string content
  in: { validate: (v, args) => args.includes(String(v)) },
  not_in: { validate: (v, args) => !args.includes(String(v)) },
  in_array: {
    validate: (v, args, data) => {
      const other = getValue(data, (args[0] ?? '').replace(/\.\*$/, ''))
      return Array.isArray(other) && other.map(String).includes(String(v))
    },
  },
  regex: { validate: (v, args) => new RegExp(args[0] ?? '').test(String(v)) },
  starts_with: { validate: (v, args) => args.some(a => String(v).startsWith(a)) },
  ends_with: { validate: (v, args) => args.some(a => String(v).endsWith(a)) },
  doesnt_start_with: { validate: (v, args) => !args.some(a => String(v).startsWith(a)) },
  doesnt_end_with: { validate: (v, args) => !args.some(a => String(v).endsWith(a)) },

  // numbers
  digits: {
    validate: (v, args) => /^\d+$/.test(String(v)) && String(v).length === Number(args[0]),
  },
  digits_between: {
    validate: (v, args) => {
      const s = String(v)
      return /^\d+$/.test(s) && s.length >= Number(args[0]) && s.length <= Number(args[1])
    },
  },
  decimal: {
    validate: (v, args) => {
      const dp = String(v).split('.')[1]?.length ?? 0
      if (args[1] !== undefined)
        return dp >= Number(args[0]) && dp <= Number(args[1])
      return dp === Number(args[0])
    },
  },
  multiple_of: { validate: (v, args) => Number(v) % Number(args[0]) === 0 },

  // size-based (numeric | string | array | file)
  min: { validate: (v, args, _d, _a, kind) => size(v, kind) >= Number(args[0]) },
  max: { validate: (v, args, _d, _a, kind) => size(v, kind) <= Number(args[0]) },
  size: { validate: (v, args, _d, _a, kind) => size(v, kind) === Number(args[0]) },
  between: {
    validate: (v, args, _d, _a, kind) =>
      size(v, kind) >= Number(args[0]) && size(v, kind) <= Number(args[1]),
  },

  // comparison (vs another field if named, else vs a number)
  gt: { validate: (v, args, data) => Number(v) > compareTo(args[0], data) },
  gte: { validate: (v, args, data) => Number(v) >= compareTo(args[0], data) },
  lt: { validate: (v, args, data) => Number(v) < compareTo(args[0], data) },
  lte: { validate: (v, args, data) => Number(v) <= compareTo(args[0], data) },

  // cross-field equality
  confirmed: { validate: (v, _a, data, attr) => getValue(data, `${attr}_confirmation`) === v },
  same: { validate: (v, args, data) => getValue(data, args[0] as string) === v },
  // `different` must not pass merely because the other field is unresolvable —
  // a dotted name used to yield `undefined !== value`, i.e. always "different".
  different: { validate: (v, args, data) => hasPath(data, args[0] as string) && getValue(data, args[0] as string) !== v },

  // dates
  date: { validate: v => !Number.isNaN(Date.parse(String(v))) },
  date_format: { validate: (v, args) => matchesDateFormat(String(v), args[0] ?? '') },
  before: { validate: (v, args, data) => Date.parse(String(v)) < dateArg(args[0], data) },
  before_or_equal: { validate: (v, args, data) => Date.parse(String(v)) <= dateArg(args[0], data) },
  after: { validate: (v, args, data) => Date.parse(String(v)) > dateArg(args[0], data) },
  after_or_equal: { validate: (v, args, data) => Date.parse(String(v)) >= dateArg(args[0], data) },
  date_equals: { validate: (v, args, data) => Date.parse(String(v)) === dateArg(args[0], data) },

  // files
  file: { validate: v => isFile(v) },
  // Sniffs the real magic bytes rather than trusting the browser-supplied
  // `Blob.type` — a spoofed Content-Type (e.g. an HTML/SVG upload declared as
  // `image/png`) fails this the same as a genuinely non-image file.
  image: {
    validate: async (v) => {
      if (!isFile(v))
        return false
      const bytes = new Uint8Array(await v.arrayBuffer())
      return sniffImageMime(bytes) !== undefined
    },
  },
  // Same content-sniffing rationale as `image` above. Per allowed type/
  // extension: if it's one we can actually verify (image/* or PDF), the
  // content must sniff as exactly that — declaring `image/png` (or naming
  // the file `x.png`) is NOT enough on its own, closing the gap where
  // unrecognizable garbage bytes could otherwise slide through under a
  // sniffable label just because sniffing came back inconclusive. Only
  // extensions with no checkable signature (txt/csv/json/svg/…) fall back to
  // the declared type/filename, same as before this existed.
  mimetypes: {
    validate: async (v, args) => {
      if (!isFile(v))
        return false
      const sniffed = sniffFileMime(new Uint8Array(await v.arrayBuffer()))
      return args.some(type => (isSniffableMime(type) ? sniffed === type : v.type === type))
    },
  },
  mimes: {
    validate: async (v, args) => {
      if (!isFile(v))
        return false
      const name = (v as File).name ?? ''
      const sniffed = sniffFileMime(new Uint8Array(await v.arrayBuffer()))
      return args.some((ext) => {
        const type = MIME[ext]
        if (type && isSniffableMime(type))
          return sniffed === type
        return v.type === type || name.toLowerCase().endsWith(`.${ext}`)
      })
    },
  },
  /**
   * Image dimension/ratio constraints (Laravel's `dimensions` rule), e.g.
   * `dimensions:min_width=200,min_height=200,ratio=16/9`. Reads the real
   * width/height from the format header (see `image-inspect.ts`) — fails
   * closed (invalid) if the file isn't a recognized image or its dimensions
   * can't be determined.
   */
  dimensions: {
    validate: async (v, args) => {
      if (!isFile(v))
        return false
      const bytes = new Uint8Array(await v.arrayBuffer())
      const dim = readImageDimensions(bytes)
      if (!dim)
        return false
      const c = parseDimensionArgs(args)
      if (c.width !== undefined && dim.width !== c.width)
        return false
      if (c.height !== undefined && dim.height !== c.height)
        return false
      if (c.minWidth !== undefined && dim.width < c.minWidth)
        return false
      if (c.maxWidth !== undefined && dim.width > c.maxWidth)
        return false
      if (c.minHeight !== undefined && dim.height < c.minHeight)
        return false
      if (c.maxHeight !== undefined && dim.height > c.maxHeight)
        return false
      if (c.ratio !== undefined && Math.abs(dim.width / dim.height - c.ratio) > 0.0001)
        return false
      return true
    },
  },

  // DB (async)
  unique: {
    validate: async (v, args) => {
      const [table, column = 'id', ignoreId] = args
      return (await countWithTimeout(table as string, column, v, ignoreId)) === 0
    },
  },
  exists: {
    validate: async (v, args) => {
      const [table, column = 'id'] = args
      return (await countWithTimeout(table as string, column, v)) > 0
    },
  },
}
