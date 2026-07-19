import type { SizeKind } from './messages'
import { getDbResolver } from './db-rules'
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
    || value === ''
    || (Array.isArray(value) && value.length === 0)
  )
}

const TRUTHY = new Set([true, 1, '1', 'yes', 'on', 'true'])
const FALSY = new Set([false, 0, '0', 'no', 'off', 'false'])
const EMAIL = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/
const IPV6 = /^(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i
const MAC = /^(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i

function isFile(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
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

function size(value: unknown, kind: SizeKind): number {
  if (kind === 'numeric')
    return Number(value)
  if (kind === 'array')
    return Array.isArray(value) ? value.length : 0
  if (kind === 'file')
    return isFile(value) ? value.size / 1024 : 0 // KB
  return String(value).length
}

function isNumeric(value: unknown): boolean {
  if (typeof value === 'number')
    return !Number.isNaN(value)
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))
}

function compareTo(arg: string | undefined, data: Data): number {
  if (arg !== undefined && arg in data)
    return Number(data[arg])
  return Number(arg)
}

/** Value of another field for date comparisons (a field name resolves to its value). */
function dateArg(arg: string | undefined, data: Data): number {
  if (arg !== undefined && arg in data)
    return Date.parse(String(data[arg]))
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

/** Build a regex from a PHP-style date format (subset: Y m d H i s). */
function dateFormatRegex(format: string): RegExp {
  const map: Record<string, string> = {
    Y: '\\d{4}',
    m: '\\d{2}',
    d: '\\d{2}',
    H: '\\d{2}',
    i: '\\d{2}',
    s: '\\d{2}',
  }
  let out = ''
  for (const ch of format) {
    out += map[ch] ?? ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

export const RULES: Record<string, Rule> = {
  // presence
  required: { implicit: true, validate: v => !isEmpty(v) },
  present: { implicit: true, validate: (_v, _a, data, attr) => attr in data },
  filled: { implicit: true, validate: (v, _a, data, attr) => !(attr in data) || !isEmpty(v) },
  nullable: { implicit: true, validate: () => true },
  sometimes: { implicit: true, validate: () => true },

  // conditional presence
  required_if: {
    implicit: true,
    validate: (v, args, data) => (String(data[args[0] as string]) === args[1] ? !isEmpty(v) : true),
  },
  required_unless: {
    implicit: true,
    validate: (v, args, data) => (String(data[args[0] as string]) !== args[1] ? !isEmpty(v) : true),
  },
  required_with: {
    implicit: true,
    validate: (v, args, data) => (args.some(f => !isEmpty(data[f])) ? !isEmpty(v) : true),
  },
  required_with_all: {
    implicit: true,
    validate: (v, args, data) => (args.every(f => !isEmpty(data[f])) ? !isEmpty(v) : true),
  },
  required_without: {
    implicit: true,
    validate: (v, args, data) => (args.some(f => isEmpty(data[f])) ? !isEmpty(v) : true),
  },
  required_without_all: {
    implicit: true,
    validate: (v, args, data) => (args.every(f => isEmpty(data[f])) ? !isEmpty(v) : true),
  },
  prohibited: { implicit: true, validate: v => isEmpty(v) },
  prohibited_if: {
    implicit: true,
    validate: (v, args, data) => (String(data[args[0] as string]) === args[1] ? isEmpty(v) : true),
  },
  prohibited_unless: {
    implicit: true,
    validate: (v, args, data) => (String(data[args[0] as string]) !== args[1] ? isEmpty(v) : true),
  },
  missing: { implicit: true, validate: (_v, _a, data, attr) => !(attr in data) },
  missing_if: {
    implicit: true,
    validate: (_v, args, data, attr) =>
      String(data[args[0] as string]) === args[1] ? !(attr in data) : true,
  },
  missing_with: {
    implicit: true,
    validate: (_v, args, data, attr) => (args.some(f => f in data) ? !(attr in data) : true),
  },
  accepted: { implicit: true, validate: v => TRUTHY.has(v as never) },
  accepted_if: {
    implicit: true,
    validate: (v, args, data) =>
      String(data[args[0] as string]) === args[1] ? TRUTHY.has(v as never) : true,
  },
  declined: { implicit: true, validate: v => FALSY.has(v as never) },
  declined_if: {
    implicit: true,
    validate: (v, args, data) =>
      String(data[args[0] as string]) === args[1] ? FALSY.has(v as never) : true,
  },

  // types
  string: { validate: v => typeof v === 'string' },
  integer: { validate: v => isNumeric(v) && Number.isInteger(Number(v)) },
  numeric: { validate: v => isNumeric(v) },
  boolean: { validate: v => TRUTHY.has(v as never) || FALSY.has(v as never) },
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
    validate: v => URL.canParse(String(v)),
  },
  uuid: { validate: v => UUID.test(String(v)) },
  ulid: { validate: v => ULID.test(String(v)) },
  ip: { validate: v => IPV4.test(String(v)) || IPV6.test(String(v)) },
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
  alpha: { validate: v => /^[A-Z]+$/i.test(String(v)) },
  alpha_num: { validate: v => /^[A-Z0-9]+$/i.test(String(v)) },
  alpha_dash: { validate: v => /^[\w-]+$/.test(String(v)) },
  // eslint-disable-next-line no-control-regex -- the ascii rule validates the full ASCII range \x00-\x7F
  ascii: { validate: v => /^[\x00-\x7F]*$/.test(String(v)) },
  uppercase: { validate: v => String(v) === String(v).toUpperCase() },
  lowercase: { validate: v => String(v) === String(v).toLowerCase() },

  // membership / string content
  in: { validate: (v, args) => args.includes(String(v)) },
  not_in: { validate: (v, args) => !args.includes(String(v)) },
  in_array: {
    validate: (v, args, data) => {
      const other = data[(args[0] ?? '').replace(/\.\*$/, '')]
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
  confirmed: { validate: (v, _a, data, attr) => data[`${attr}_confirmation`] === v },
  same: { validate: (v, args, data) => data[args[0] as string] === v },
  different: { validate: (v, args, data) => data[args[0] as string] !== v },

  // dates
  date: { validate: v => !Number.isNaN(Date.parse(String(v))) },
  date_format: { validate: (v, args) => dateFormatRegex(args[0] ?? '').test(String(v)) },
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
  mimetypes: { validate: (v, args) => isFile(v) && args.includes(v.type) },
  mimes: {
    validate: (v, args) => {
      if (!isFile(v))
        return false
      const name = (v as File).name ?? ''
      return args.some(ext => v.type === MIME[ext] || name.toLowerCase().endsWith(`.${ext}`))
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
      return (await getDbResolver().count(table as string, column, v, ignoreId)) === 0
    },
  },
  exists: {
    validate: async (v, args) => {
      const [table, column = 'id'] = args
      return (await getDbResolver().count(table as string, column, v)) > 0
    },
  },
}
