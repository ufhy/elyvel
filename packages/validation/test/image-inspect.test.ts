import { describe, expect, test } from 'bun:test'
import { readImageDimensions, sniffImageMime } from '../src/image-inspect'

function fakePng(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(24)
  buf.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0) // signature
  buf.set([0x00, 0x00, 0x00, 0x0D], 8) // IHDR length (unused by the reader)
  buf.set([0x49, 0x48, 0x44, 0x52], 12) // "IHDR"
  const dv = new DataView(buf.buffer)
  dv.setUint32(16, width)
  dv.setUint32(20, height)
  return buf
}

function fakeJpeg(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(12)
  buf.set([0xFF, 0xD8], 0) // SOI
  buf.set([0xFF, 0xC0], 2) // SOF0
  buf.set([0x00, 0x0B], 4) // segment length (arbitrary, not load-bearing here)
  buf[6] = 0x08 // precision
  const dv = new DataView(buf.buffer)
  dv.setUint16(7, height)
  dv.setUint16(9, width)
  return buf
}

function fakeGif(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(10)
  buf.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0) // "GIF89a"
  const dv = new DataView(buf.buffer)
  dv.setUint16(6, width, true)
  dv.setUint16(8, height, true)
  return buf
}

describe('sniffImageMime', () => {
  test('recognizes real magic bytes', () => {
    expect(sniffImageMime(fakePng(1, 1))).toBe('image/png')
    expect(sniffImageMime(fakeJpeg(1, 1))).toBe('image/jpeg')
    expect(sniffImageMime(fakeGif(1, 1))).toBe('image/gif')
  })

  test('rejects arbitrary bytes regardless of what a caller might claim they are', () => {
    const notAnImage = new TextEncoder().encode('<script>alert(1)</script>')
    expect(sniffImageMime(notAnImage)).toBeUndefined()
  })
})

describe('readImageDimensions', () => {
  test('reads width/height from each format header', () => {
    expect(readImageDimensions(fakePng(800, 600))).toEqual({ width: 800, height: 600 })
    expect(readImageDimensions(fakeJpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 })
    expect(readImageDimensions(fakeGif(320, 240))).toEqual({ width: 320, height: 240 })
  })

  test('returns undefined for a non-image or truncated buffer', () => {
    expect(readImageDimensions(new TextEncoder().encode('not an image'))).toBeUndefined()
    expect(readImageDimensions(fakePng(800, 600).slice(0, 10))).toBeUndefined()
  })
})
