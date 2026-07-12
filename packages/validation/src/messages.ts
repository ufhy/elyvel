/** Which "size" variant a message uses, based on the value's type. */
export type SizeKind = 'numeric' | 'string' | 'array'

/** Default Laravel-style messages. Size-based rules carry per-type variants. */
export const DEFAULT_MESSAGES: Record<string, string | Record<SizeKind, string>> = {
  required: 'The :attribute field is required.',
  required_if: 'The :attribute field is required when :other is :value.',
  required_with: 'The :attribute field is required when :values is present.',
  required_without: 'The :attribute field is required when :values is not present.',
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
  json: 'The :attribute field must be a valid JSON string.',
  alpha: 'The :attribute field must only contain letters.',
  alpha_num: 'The :attribute field must only contain letters and numbers.',
  alpha_dash:
    'The :attribute field must only contain letters, numbers, dashes, and underscores.',
  in: 'The selected :attribute is invalid.',
  not_in: 'The selected :attribute is invalid.',
  regex: 'The :attribute field format is invalid.',
  confirmed: 'The :attribute field confirmation does not match.',
  same: 'The :attribute field must match :other.',
  different: 'The :attribute field and :other must be different.',
  accepted: 'The :attribute field must be accepted.',
  declined: 'The :attribute field must be declined.',
  starts_with: 'The :attribute field must start with one of the following: :values.',
  ends_with: 'The :attribute field must end with one of the following: :values.',
  digits: 'The :attribute field must be :digits digits.',
  date: 'The :attribute field must be a valid date.',
  before: 'The :attribute field must be a date before :date.',
  after: 'The :attribute field must be a date after :date.',
  unique: 'The :attribute has already been taken.',
  exists: 'The selected :attribute is invalid.',
  gt: 'The :attribute field must be greater than :value.',
  gte: 'The :attribute field must be greater than or equal to :value.',
  lt: 'The :attribute field must be less than :value.',
  lte: 'The :attribute field must be less than or equal to :value.',
  min: {
    numeric: 'The :attribute field must be at least :min.',
    string: 'The :attribute field must be at least :min characters.',
    array: 'The :attribute field must have at least :min items.',
  },
  max: {
    numeric: 'The :attribute field must not be greater than :max.',
    string: 'The :attribute field must not be greater than :max characters.',
    array: 'The :attribute field must not have more than :max items.',
  },
  between: {
    numeric: 'The :attribute field must be between :min and :max.',
    string: 'The :attribute field must be between :min and :max characters.',
    array: 'The :attribute field must have between :min and :max items.',
  },
  size: {
    numeric: 'The :attribute field must be :size.',
    string: 'The :attribute field must be :size characters.',
    array: 'The :attribute field must contain :size items.',
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

  const template =
    custom[`${attribute}.${rule}`] ?? custom[rule] ?? pickTemplate(rule, sizeKind) ?? FALLBACK

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
    .replaceAll(':values', args.join(', '))
}

function pickTemplate(rule: string, sizeKind: SizeKind): string | undefined {
  const entry = DEFAULT_MESSAGES[rule]
  if (entry === undefined) return undefined
  return typeof entry === 'string' ? entry : entry[sizeKind]
}
