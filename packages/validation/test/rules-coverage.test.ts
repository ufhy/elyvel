import { describe, expect, test } from 'bun:test'
import { configureDbRules } from '../src/db-rules'
import { Validator } from '../src/validator'

/**
 * Exercises every built-in rule (pass + fail) through the public Validator, so
 * each rule's `validate` fn is actually run — the rules registry was ~1/3
 * function-covered before this. Cross-field / file / date / DB rules that need
 * context get their own explicit tests below the table.
 */

async function passes(data: Record<string, unknown>, rule: string, field = 'f'): Promise<boolean> {
  return Validator.make(data, { [field]: rule }).passes()
}

// Simple single-value rules: [rule, passingValues, failingValues].
const CASES: [string, unknown[], unknown[]][] = [
  // types
  ['string', ['hi', ''], [1, true, {}]],
  ['integer', [5, '5', -3], [1.5, 'x']],
  ['numeric', [1.5, '2.5', 0], ['x', 'abc']],
  ['boolean', [true, false, 1, 0, '1', '0', 'yes', 'no'], ['maybe', 2, 'x']],
  // formats
  ['email', ['a@b.co', 'x.y@z.io'], ['nope', 'a@b', '@b.co']],
  ['url', ['https://a.co', 'http://x.io/p?q=1'], ['not a url', 'http://']],
  ['uuid', ['11111111-1111-1111-1111-111111111111'], ['nope', '1234']],
  ['ulid', ['01ARZ3NDEKTSV4RRFFQ69G5FAV'], ['nope', 'lowercase-bad']],
  ['ip', ['127.0.0.1', '::1', 'fe80::1'], ['999.1.1.1.1', 'nope']],
  ['mac_address', ['3D:F2:C9:A6:B3:4F', '3d-f2-c9-a6-b3-4f'], ['nope', '3D:F2']],
  ['hex_color', ['#fff', '#ffffff', '#ffffffff'], ['fff', '#ggg', '#ff']],
  ['json', ['{"a":1}', '[1,2]', '"s"'], ['{bad', 'undefined']],
  ['timezone', ['UTC', 'Asia/Makassar'], ['Mars/Phobos', 'nope']],
  ['alpha', ['abcXYZ'], ['ab1', 'a b']],
  ['alpha_num', ['abc123'], ['abc-1', 'a b']],
  ['alpha_dash', ['a-b_c1'], ['a b', 'a.b']],
  ['ascii', ['plain text!', ''], ['café', 'naïve']],
  ['uppercase', ['ABC', '123'], ['Abc', 'abc']],
  ['lowercase', ['abc', '123'], ['Abc', 'ABC']],
  // membership / string content
  ['in:a,b,c', ['a', 'c'], ['d', 'e']],
  ['not_in:a,b', ['c', 'd'], ['a', 'b']],
  ['regex:^\\d+$', ['123'], ['12a', 'abc']],
  ['starts_with:foo,bar', ['foobar', 'barbaz'], ['bazfoo']],
  ['ends_with:foo,bar', ['bazfoo', 'bazbar'], ['foobaz']],
  ['doesnt_start_with:foo', ['barfoo'], ['foobar']],
  ['doesnt_end_with:foo', ['foobar'], ['barfoo']],
  // numbers
  ['digits:3', ['123'], ['12', '1234', '12a']],
  ['digits_between:2,4', ['12', '1234'], ['1', '12345', 'ab']],
  ['multiple_of:3', [9, '12'], [10, 7]],
  // dates
  ['date', ['2026-01-15', '2026-01-15T10:00:00Z'], ['not-a-date', 'xyz']],
  ['date_format:Y-m-d', ['2026-07-16'], ['2026/07/16', '16-07-2026']],
]

describe('validation rules — table coverage', () => {
  for (const [rule, good, bad] of CASES) {
    test(`${rule}`, async () => {
      for (const v of good) expect(await passes({ f: v }, rule)).toBe(true)
      for (const v of bad) expect(await passes({ f: v }, rule)).toBe(false)
    })
  }
})

describe('validation rules — presence & conditionals', () => {
  test('present / filled / missing', async () => {
    expect(await passes({ f: '' }, 'present')).toBe(true)
    expect(await passes({}, 'present')).toBe(false)
    expect(await passes({ f: '' }, 'filled')).toBe(false)
    expect(await passes({}, 'filled')).toBe(true) // absent → passes
    expect(await passes({}, 'missing')).toBe(true)
    expect(await passes({ f: 'x' }, 'missing')).toBe(false)
  })

  test('nullable / sometimes always pass', async () => {
    expect(await passes({ f: null }, 'nullable')).toBe(true)
    expect(await passes({ f: null }, 'sometimes')).toBe(true)
  })

  test('required_if / required_unless', async () => {
    expect(await Validator.make({ role: 'admin', code: '' }, { code: 'required_if:role,admin' }).passes()).toBe(false)
    expect(await Validator.make({ role: 'user', code: '' }, { code: 'required_if:role,admin' }).passes()).toBe(true)
    expect(await Validator.make({ role: 'user', code: '' }, { code: 'required_unless:role,admin' }).passes()).toBe(false)
  })

  test('required_with / required_with_all / required_without / required_without_all', async () => {
    expect(await Validator.make({ a: 'x', b: '' }, { b: 'required_with:a' }).passes()).toBe(false)
    expect(await Validator.make({ a: 'x', c: 'y', b: '' }, { b: 'required_with_all:a,c' }).passes()).toBe(false)
    expect(await Validator.make({ b: '' }, { b: 'required_without:a' }).passes()).toBe(false)
    expect(await Validator.make({ b: '' }, { b: 'required_without_all:a,c' }).passes()).toBe(false)
  })

  test('prohibited / prohibited_if / prohibited_unless', async () => {
    expect(await passes({ f: 'x' }, 'prohibited')).toBe(false)
    expect(await passes({ f: '' }, 'prohibited')).toBe(true)
    expect(await Validator.make({ role: 'guest', f: 'x' }, { f: 'prohibited_if:role,guest' }).passes()).toBe(false)
    expect(await Validator.make({ role: 'admin', f: 'x' }, { f: 'prohibited_unless:role,admin' }).passes()).toBe(true)
  })

  test('missing_if / missing_with', async () => {
    expect(await Validator.make({ role: 'admin', f: 'x' }, { f: 'missing_if:role,admin' }).passes()).toBe(false)
    expect(await Validator.make({ a: 'x', f: 'y' }, { f: 'missing_with:a' }).passes()).toBe(false)
  })

  test('accepted / accepted_if / declined / declined_if', async () => {
    expect(await passes({ f: 'yes' }, 'accepted')).toBe(true)
    expect(await passes({ f: 'no' }, 'accepted')).toBe(false)
    expect(await passes({ f: 'no' }, 'declined')).toBe(true)
    expect(await Validator.make({ tos: 'y', f: 'no' }, { f: 'accepted_if:tos,y' }).passes()).toBe(false)
    expect(await Validator.make({ tos: 'y', f: 'yes' }, { f: 'declined_if:tos,y' }).passes()).toBe(false)
  })
})

describe('validation rules — cross-field, size, comparison', () => {
  test('array with allowed keys', async () => {
    expect(await passes({ f: [1, 2] }, 'array')).toBe(true)
    expect(await Validator.make({ f: { a: 1, b: 2 } }, { f: 'array:a,b' }).passes()).toBe(true)
    expect(await Validator.make({ f: { a: 1, z: 2 } }, { f: 'array:a,b' }).passes()).toBe(false)
  })

  test('in_array', async () => {
    expect(await Validator.make({ list: ['a', 'b'], f: 'a' }, { f: 'in_array:list.*' }).passes()).toBe(true)
    expect(await Validator.make({ list: ['a', 'b'], f: 'z' }, { f: 'in_array:list.*' }).passes()).toBe(false)
  })

  test('decimal places', async () => {
    expect(await passes({ f: '1.50' }, 'decimal:2')).toBe(true)
    expect(await passes({ f: '1.5' }, 'decimal:2')).toBe(false)
    expect(await passes({ f: '1.55' }, 'decimal:1,3')).toBe(true)
  })

  test('min / max / size / between across kinds', async () => {
    expect(await passes({ f: 20 }, 'integer|min:18')).toBe(true) // numeric kind
    expect(await passes({ f: 5 }, 'integer|min:18')).toBe(false)
    expect(await passes({ f: 'abcd' }, 'string|max:3')).toBe(false) // string kind
    expect(await passes({ f: [1, 2, 3] }, 'array|size:3')).toBe(true) // array kind
    expect(await passes({ f: 5 }, 'integer|between:1,10')).toBe(true)
    expect(await passes({ f: 50 }, 'integer|between:1,10')).toBe(false)
  })

  test('gt / gte / lt / lte vs literal and vs field', async () => {
    expect(await passes({ f: 10 }, 'gt:5')).toBe(true)
    expect(await passes({ f: 5 }, 'gte:5')).toBe(true)
    expect(await passes({ f: 3 }, 'lt:5')).toBe(true)
    expect(await passes({ f: 5 }, 'lte:5')).toBe(true)
    expect(await Validator.make({ min: 10, f: 5 }, { f: 'gt:min' }).passes()).toBe(false)
    expect(await Validator.make({ min: 3, f: 5 }, { f: 'gt:min' }).passes()).toBe(true)
  })

  test('confirmed / same / different', async () => {
    expect(await Validator.make({ f: 'p', f_confirmation: 'p' }, { f: 'confirmed' }).passes()).toBe(true)
    expect(await Validator.make({ f: 'p', f_confirmation: 'q' }, { f: 'confirmed' }).passes()).toBe(false)
    expect(await Validator.make({ a: 'x', f: 'x' }, { f: 'same:a' }).passes()).toBe(true)
    expect(await Validator.make({ a: 'x', f: 'x' }, { f: 'different:a' }).passes()).toBe(false)
  })

  test('date comparisons: before / after / date_equals', async () => {
    expect(await passes({ f: '2026-01-01' }, 'before:2026-06-01')).toBe(true)
    expect(await passes({ f: '2026-12-01' }, 'before:2026-06-01')).toBe(false)
    expect(await passes({ f: '2026-06-01' }, 'before_or_equal:2026-06-01')).toBe(true)
    expect(await passes({ f: '2026-12-01' }, 'after:2026-06-01')).toBe(true)
    expect(await passes({ f: '2026-06-01' }, 'after_or_equal:2026-06-01')).toBe(true)
    expect(await passes({ f: '2026-06-01' }, 'date_equals:2026-06-01')).toBe(true)
    // field-relative
    expect(await Validator.make({ start: '2026-01-01', f: '2026-02-01' }, { f: 'after:start' }).passes()).toBe(true)
  })
})

/** A minimal-but-real PNG: real signature + IHDR (only the header is ever read). */
function pngBytes(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(24)
  buf.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0)
  buf.set([0x00, 0x00, 0x00, 0x0D], 8)
  buf.set([0x49, 0x48, 0x44, 0x52], 12) // "IHDR"
  const dv = new DataView(buf.buffer)
  dv.setUint32(16, width)
  dv.setUint32(20, height)
  return buf
}

describe('validation rules — files', () => {
  const png = new File([pngBytes(100, 100)], 'a.png', { type: 'image/png' })
  const txt = new File([new Uint8Array(2048)], 'a.txt', { type: 'text/plain' })

  test('file / image / mimetypes / mimes', async () => {
    expect(await passes({ f: png }, 'file')).toBe(true)
    expect(await passes({ f: 'x' }, 'file')).toBe(false)
    expect(await passes({ f: png }, 'image')).toBe(true)
    expect(await passes({ f: txt }, 'image')).toBe(false)
    expect(await passes({ f: png }, 'mimetypes:image/png')).toBe(true)
    expect(await passes({ f: png }, 'mimes:png,jpg')).toBe(true)
    expect(await passes({ f: txt }, 'mimes:png')).toBe(false)
  })

  test('file size honors the file kind (KB)', async () => {
    expect(await passes({ f: txt }, 'file|max:1')).toBe(false) // 2KB > 1KB
    expect(await passes({ f: txt }, 'file|max:4')).toBe(true)
  })

  test('image sniffs real content — a spoofed Content-Type doesn\'t fool it', async () => {
    // Declares image/png, but the actual bytes are plain text — this is the
    // exact "image hijacking" shape (upload a non-image, lie about its type).
    const spoofed = new File([new Uint8Array([1, 2, 3, 4, 5])], 'a.png', { type: 'image/png' })
    expect(await passes({ f: spoofed }, 'image')).toBe(false)
  })

  test('mimes/mimetypes sniff real content too — a fake .png fails even with a matching name/type', async () => {
    // Same spoof shape as the `image` test above, but through mimes/mimetypes
    // specifically — an attacker uploading an HTML/script payload named
    // "photo.png" with Content-Type: image/png must not pass `mimes:png`.
    const spoofed = new File([new Uint8Array([1, 2, 3, 4, 5])], 'a.png', { type: 'image/png' })
    expect(await passes({ f: spoofed }, 'mimes:png,jpg')).toBe(false)
    expect(await passes({ f: spoofed }, 'mimetypes:image/png')).toBe(false)

    // A real PDF passes `mimes:pdf` even if the declared type/name lied the other way.
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x34]) // "%PDF-1.4"
    const fakedAsPng = new File([pdfBytes], 'a.png', { type: 'image/png' })
    expect(await passes({ f: fakedAsPng }, 'mimes:pdf')).toBe(true)
    expect(await passes({ f: fakedAsPng }, 'mimes:png')).toBe(false)

    // Plain text has no binary signature to sniff — falls back to the
    // declared type/extension, same behavior as before this fix. (Bun
    // normalizes a `text/plain` File's `.type` to include `;charset=utf-8`.)
    expect(await passes({ f: txt }, `mimetypes:${txt.type}`)).toBe(true)
    expect(await passes({ f: txt }, 'mimes:txt')).toBe(true)
  })

  test('dimensions: min/max/exact width & height, and ratio', async () => {
    const wide = new File([pngBytes(1600, 900)], 'wide.png', { type: 'image/png' })
    const small = new File([pngBytes(50, 50)], 'small.png', { type: 'image/png' })

    expect(await passes({ f: wide }, 'dimensions:min_width=1000,min_height=500')).toBe(true)
    expect(await passes({ f: small }, 'dimensions:min_width=1000,min_height=500')).toBe(false)
    expect(await passes({ f: wide }, 'dimensions:max_width=1000')).toBe(false)
    expect(await passes({ f: wide }, `dimensions:width=1600,height=900`)).toBe(true)
    expect(await passes({ f: wide }, 'dimensions:width=1601')).toBe(false)
    expect(await passes({ f: wide }, 'dimensions:ratio=16/9')).toBe(true)
    expect(await passes({ f: small }, 'dimensions:ratio=16/9')).toBe(false) // 1:1, not 16:9
    expect(await passes({ f: txt }, 'dimensions:min_width=1')).toBe(false) // not an image at all
  })
})

describe('validation rules — DB (unique / exists)', () => {
  test('unique passes when count 0, exists passes when count > 0', async () => {
    configureDbRules({
      count: async (_table, _column, value) => (value === 'taken' ? 1 : 0),
    })
    expect(await passes({ f: 'free' }, 'unique:users')).toBe(true)
    expect(await passes({ f: 'taken' }, 'unique:users')).toBe(false)
    expect(await passes({ f: 'taken' }, 'exists:users')).toBe(true)
    expect(await passes({ f: 'free' }, 'exists:users')).toBe(false)
  })
})
