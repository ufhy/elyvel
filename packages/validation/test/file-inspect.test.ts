import { describe, expect, test } from 'bun:test'
import { sniffFileMime } from '../src/file-inspect'

describe('sniffFileMime', () => {
  test('recognizes a PDF by its magic bytes', () => {
    const pdf = new TextEncoder().encode('%PDF-1.4\n...')
    expect(sniffFileMime(pdf)).toBe('application/pdf')
  })

  test('delegates to image sniffing for image formats', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])
    expect(sniffFileMime(png)).toBe('image/png')
  })

  test('returns undefined for unrecognizable/plain-text content', () => {
    expect(sniffFileMime(new TextEncoder().encode('just some text'))).toBeUndefined()
    expect(sniffFileMime(new Uint8Array(0))).toBeUndefined()
  })
})
