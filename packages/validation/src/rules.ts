import { getDbResolver } from './db-rules'
import type { SizeKind } from './messages'

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
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

const TRUTHY = new Set([true, 1, '1', 'yes', 'on', 'true'])
const FALSY = new Set([false, 0, '0', 'no', 'off', 'false'])
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/i
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/
const IPV6 = /^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i

function size(value: unknown, kind: SizeKind): number {
  if (kind === 'numeric') return Number(value)
  if (kind === 'array') return Array.isArray(value) ? value.length : 0
  return String(value).length
}

function isNumeric(value: unknown): boolean {
  if (typeof value === 'number') return !Number.isNaN(value)
  return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))
}

export const RULES: Record<string, Rule> = {
  required: { implicit: true, validate: (v) => !isEmpty(v) },
  present: { implicit: true, validate: (_v, _a, data, attr) => attr in data },
  filled: { implicit: true, validate: (v, _a, data, attr) => !(attr in data) || !isEmpty(v) },
  nullable: { implicit: true, validate: () => true },
  sometimes: { implicit: true, validate: () => true },

  string: { validate: (v) => typeof v === 'string' },
  integer: { validate: (v) => isNumeric(v) && Number.isInteger(Number(v)) },
  numeric: { validate: (v) => isNumeric(v) },
  boolean: { validate: (v) => TRUTHY.has(v as never) || FALSY.has(v as never) },
  array: { validate: (v) => Array.isArray(v) },

  email: { validate: (v) => EMAIL.test(String(v)) },
  url: {
    validate: (v) => {
      try {
        new URL(String(v))
        return true
      } catch {
        return false
      }
    },
  },
  uuid: { validate: (v) => UUID.test(String(v)) },
  ulid: { validate: (v) => ULID.test(String(v)) },
  ip: { validate: (v) => IPV4.test(String(v)) || IPV6.test(String(v)) },
  json: {
    validate: (v) => {
      try {
        JSON.parse(String(v))
        return true
      } catch {
        return false
      }
    },
  },
  alpha: { validate: (v) => /^[A-Za-z]+$/.test(String(v)) },
  alpha_num: { validate: (v) => /^[A-Za-z0-9]+$/.test(String(v)) },
  alpha_dash: { validate: (v) => /^[A-Za-z0-9_-]+$/.test(String(v)) },

  in: { validate: (v, args) => args.includes(String(v)) },
  not_in: { validate: (v, args) => !args.includes(String(v)) },
  regex: { validate: (v, args) => new RegExp(args[0] ?? '').test(String(v)) },
  starts_with: { validate: (v, args) => args.some((a) => String(v).startsWith(a)) },
  ends_with: { validate: (v, args) => args.some((a) => String(v).endsWith(a)) },
  digits: { validate: (v, args) => /^\d+$/.test(String(v)) && String(v).length === Number(args[0]) },

  accepted: { implicit: true, validate: (v) => TRUTHY.has(v as never) },
  declined: { implicit: true, validate: (v) => FALSY.has(v as never) },

  // size-based
  min: { validate: (v, args, _d, _a, kind) => size(v, kind) >= Number(args[0]) },
  max: { validate: (v, args, _d, _a, kind) => size(v, kind) <= Number(args[0]) },
  size: { validate: (v, args, _d, _a, kind) => size(v, kind) === Number(args[0]) },
  between: {
    validate: (v, args, _d, _a, kind) =>
      size(v, kind) >= Number(args[0]) && size(v, kind) <= Number(args[1]),
  },

  // comparison (vs another field if the arg names one, else vs a number)
  gt: { validate: (v, args, data) => Number(v) > compareTo(args[0], data) },
  gte: { validate: (v, args, data) => Number(v) >= compareTo(args[0], data) },
  lt: { validate: (v, args, data) => Number(v) < compareTo(args[0], data) },
  lte: { validate: (v, args, data) => Number(v) <= compareTo(args[0], data) },

  // cross-field
  confirmed: {
    validate: (v, _a, data, attr) => data[`${attr}_confirmation`] === v,
  },
  same: { validate: (v, args, data) => data[args[0] as string] === v },
  different: { validate: (v, args, data) => data[args[0] as string] !== v },

  // date
  date: { validate: (v) => !Number.isNaN(Date.parse(String(v))) },
  before: { validate: (v, args) => Date.parse(String(v)) < Date.parse(args[0] ?? '') },
  after: { validate: (v, args) => Date.parse(String(v)) > Date.parse(args[0] ?? '') },

  // conditional presence (implicit)
  required_if: {
    implicit: true,
    validate: (v, args, data) =>
      String(data[args[0] as string]) === args[1] ? !isEmpty(v) : true,
  },
  required_with: {
    implicit: true,
    validate: (v, args, data) =>
      args.some((f) => !isEmpty(data[f])) ? !isEmpty(v) : true,
  },
  required_without: {
    implicit: true,
    validate: (v, args, data) =>
      args.some((f) => isEmpty(data[f])) ? !isEmpty(v) : true,
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

function compareTo(arg: string | undefined, data: Data): number {
  if (arg !== undefined && arg in data) return Number(data[arg])
  return Number(arg)
}
