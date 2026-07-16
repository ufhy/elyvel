/** Which "size" variant a message uses, based on the value's type. */
export type SizeKind = 'numeric' | 'string' | 'array' | 'file'

/** Default Laravel-style messages. Size-based rules carry per-type variants. */
export const DEFAULT_MESSAGES: Record<string, string | Record<SizeKind, string>> = {
  required: 'The :attribute field is required.',
  required_if: 'The :attribute field is required when :other is :value.',
  required_unless: 'The :attribute field is required unless :other is :value.',
  required_with: 'The :attribute field is required when :values is present.',
  required_with_all: 'The :attribute field is required when :values are present.',
  required_without: 'The :attribute field is required when :values is not present.',
  required_without_all: 'The :attribute field is required when none of :values are present.',
  prohibited: 'The :attribute field is prohibited.',
  prohibited_if: 'The :attribute field is prohibited when :other is :value.',
  prohibited_unless: 'The :attribute field is prohibited unless :other is :value.',
  missing: 'The :attribute field must be missing.',
  missing_if: 'The :attribute field must be missing when :other is :value.',
  missing_with: 'The :attribute field must be missing when :values is present.',
  accepted_if: 'The :attribute field must be accepted when :other is :value.',
  declined_if: 'The :attribute field must be declined when :other is :value.',
  present: 'The :attribute field must be present.',
  filled: 'The :attribute field must have a value.',
  string: 'The :attribute field must be a string.',
  integer: 'The :attribute field must be an integer.',
  numeric: 'The :attribute field must be a number.',
  boolean: 'The :attribute field must be true or false.',
  array: 'The :attribute field must be an array.',
  email: 'The :attribute field must be a valid email address.',
  url: 'The :attribute field must be a valid URL.',
  uuid: 'The :attribute field must be a valid UUID.',
  ulid: 'The :attribute field must be a valid ULID.',
  ip: 'The :attribute field must be a valid IP address.',
  mac_address: 'The :attribute field must be a valid MAC address.',
  hex_color: 'The :attribute field must be a valid hexadecimal color.',
  timezone: 'The :attribute field must be a valid timezone.',
  json: 'The :attribute field must be a valid JSON string.',
  alpha: 'The :attribute field must only contain letters.',
  alpha_num: 'The :attribute field must only contain letters and numbers.',
  alpha_dash: 'The :attribute field must only contain letters, numbers, dashes, and underscores.',
  ascii: 'The :attribute field must only contain single-byte alphanumeric characters.',
  uppercase: 'The :attribute field must be uppercase.',
  lowercase: 'The :attribute field must be lowercase.',
  in: 'The selected :attribute is invalid.',
  not_in: 'The selected :attribute is invalid.',
  in_array: 'The :attribute field must exist in :other.',
  distinct: 'The :attribute field has a duplicate value.',
  regex: 'The :attribute field format is invalid.',
  confirmed: 'The :attribute field confirmation does not match.',
  same: 'The :attribute field must match :other.',
  different: 'The :attribute field and :other must be different.',
  accepted: 'The :attribute field must be accepted.',
  declined: 'The :attribute field must be declined.',
  starts_with: 'The :attribute field must start with one of the following: :values.',
  ends_with: 'The :attribute field must end with one of the following: :values.',
  doesnt_start_with: 'The :attribute field must not start with one of the following: :values.',
  doesnt_end_with: 'The :attribute field must not end with one of the following: :values.',
  digits: 'The :attribute field must be :digits digits.',
  digits_between: 'The :attribute field must be between :min and :max digits.',
  decimal: 'The :attribute field must have :min decimal places.',
  multiple_of: 'The :attribute field must be a multiple of :min.',
  date: 'The :attribute field must be a valid date.',
  date_format: 'The :attribute field must match the format :format.',
  date_equals: 'The :attribute field must be a date equal to :date.',
  before: 'The :attribute field must be a date before :date.',
  before_or_equal: 'The :attribute field must be a date before or equal to :date.',
  after: 'The :attribute field must be a date after :date.',
  after_or_equal: 'The :attribute field must be a date after or equal to :date.',
  unique: 'The :attribute has already been taken.',
  exists: 'The selected :attribute is invalid.',
  file: 'The :attribute field must be a file.',
  image: 'The :attribute field must be an image.',
  mimes: 'The :attribute field must be a file of type: :values.',
  mimetypes: 'The :attribute field must be a file of type: :values.',
  gt: 'The :attribute field must be greater than :value.',
  gte: 'The :attribute field must be greater than or equal to :value.',
  lt: 'The :attribute field must be less than :value.',
  lte: 'The :attribute field must be less than or equal to :value.',
  min: {
    numeric: 'The :attribute field must be at least :min.',
    string: 'The :attribute field must be at least :min characters.',
    array: 'The :attribute field must have at least :min items.',
    file: 'The :attribute field must be at least :min kilobytes.',
  },
  max: {
    numeric: 'The :attribute field must not be greater than :max.',
    string: 'The :attribute field must not be greater than :max characters.',
    array: 'The :attribute field must not have more than :max items.',
    file: 'The :attribute field must not be greater than :max kilobytes.',
  },
  between: {
    numeric: 'The :attribute field must be between :min and :max.',
    string: 'The :attribute field must be between :min and :max characters.',
    array: 'The :attribute field must have between :min and :max items.',
    file: 'The :attribute field must be between :min and :max kilobytes.',
  },
  size: {
    numeric: 'The :attribute field must be :size.',
    string: 'The :attribute field must be :size characters.',
    array: 'The :attribute field must contain :size items.',
    file: 'The :attribute field must be :size kilobytes.',
  },
}

/** Fallback for rules without a specific message. */
const FALLBACK = 'The :attribute field is invalid.'

/** Humanize an attribute name, à la Laravel (`first_name` → "first name"). */
export function humanizeAttribute(attribute: string): string {
  return attribute.replace(/_/g, ' ').replace(/\./g, '.').toLowerCase()
}

interface MessageInput {
  rule: string
  attribute: string
  args: string[]
  sizeKind: SizeKind
  /** Custom `field.rule` / `rule` overrides (from FormRequest.messages()). */
  custom?: Record<string, string>
  /** Custom attribute display names (from FormRequest.attributes()). */
  attributes?: Record<string, string>
}

/** Resolve the final human message for a failed rule, applying placeholders. */
export function formatMessage(input: MessageInput): string {
  const { rule, attribute, args, sizeKind, custom = {}, attributes = {} } = input

  const template
    = custom[`${attribute}.${rule}`] ?? custom[rule] ?? pickTemplate(rule, sizeKind) ?? FALLBACK

  const displayName = attributes[attribute] ?? humanizeAttribute(attribute)

  return template
    .replaceAll(':attribute', displayName)
    .replaceAll(':min', args[0] ?? '')
    .replaceAll(':max', args[1] ?? args[0] ?? '')
    .replaceAll(':size', args[0] ?? '')
    .replaceAll(':digits', args[0] ?? '')
    .replaceAll(':value', args[1] ?? args[0] ?? '')
    .replaceAll(':other', humanizeAttribute(args[0] ?? ''))
    .replaceAll(':date', args[0] ?? '')
    .replaceAll(':format', args[0] ?? '')
    .replaceAll(':values', args.join(', '))
}

function pickTemplate(rule: string, sizeKind: SizeKind): string | undefined {
  const entry = DEFAULT_MESSAGES[rule]
  if (entry === undefined)
    return undefined
  return typeof entry === 'string' ? entry : entry[sizeKind]
}
