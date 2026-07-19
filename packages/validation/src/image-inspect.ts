/**
 * Real image inspection — reads magic bytes / format headers instead of
 * trusting the browser-supplied `Blob.type`. A malicious upload can declare
 * `Content-Type: image/png` for an arbitrary file (HTML/SVG-with-script/PHP);
 * `image`/`dimensions` sniff the actual bytes so that spoof doesn't pass
 * validation ("image hijacking" / polyglot uploads).
 *
 * Dimensions are read straight from each format's header — no decode, no
 * external dependency. Covers PNG, JPEG, GIF, BMP, and the common WebP
 * variants (VP8X, simple VP8/VP8L).
 */

export interface ImageDimensions {
  width: number
  height: number
}

function readUInt16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! * 0x1000000) + (bytes[offset + 1]! << 16) + (bytes[offset + 2]! << 8) + bytes[offset + 3]!
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8)
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
}

function readInt32LE(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getInt32(0, true)
}

function matches(bytes: Uint8Array, offset: number, sequence: number[]): boolean {
  if (bytes.length < offset + sequence.length)
    return false
  return sequence.every((byte, i) => bytes[offset + i] === byte)
}

const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
const BMP_SIG = [0x42, 0x4D]
const RIFF = [0x52, 0x49, 0x46, 0x46]
const WEBP = [0x57, 0x45, 0x42, 0x50]

/** MIME type from magic bytes, or `undefined` if not a recognized image format. */
export function sniffImageMime(bytes: Uint8Array): string | undefined {
  if (matches(bytes, 0, PNG_SIG))
    return 'image/png'
  if (matches(bytes, 0, [0xFF, 0xD8, 0xFF]))
    return 'image/jpeg'
  if (matches(bytes, 0, GIF87A) || matches(bytes, 0, GIF89A))
    return 'image/gif'
  if (matches(bytes, 0, BMP_SIG))
    return 'image/bmp'
  if (matches(bytes, 0, RIFF) && matches(bytes, 8, WEBP))
    return 'image/webp'
  return undefined
}

function pngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // IHDR is always the first chunk: 8-byte signature, 4-byte length, "IHDR", width, height.
  if (bytes.length < 24 || !matches(bytes, 12, [0x49, 0x48, 0x44, 0x52]))
    return undefined
  return { width: readUInt32BE(bytes, 16), height: readUInt32BE(bytes, 20) }
}

function jpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // Scan markers for a Start-Of-Frame segment (SOF0-SOF15, excluding DHT/JPG/DAC).
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xFF)
      return undefined
    const marker = bytes[offset + 1]!
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD9)) {
      offset += 2
      continue
    }
    const isSof = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC
    const length = readUInt16BE(bytes, offset + 2)
    if (isSof) {
      return { height: readUInt16BE(bytes, offset + 5), width: readUInt16BE(bytes, offset + 7) }
    }
    offset += 2 + length
  }
  return undefined
}

function gifDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 10)
    return undefined
  return { width: readUInt16LE(bytes, 6), height: readUInt16LE(bytes, 8) }
}

function bmpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  // BITMAPINFOHEADER: width/height are signed 32-bit LE at offset 18/22; height
  // is negative for a top-down bitmap — magnitude is what matters here.
  if (bytes.length < 26)
    return undefined
  return { width: readInt32LE(bytes, 18), height: Math.abs(readInt32LE(bytes, 22)) }
}

function webpDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.length < 30)
    return undefined
  const chunk = String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)
  if (chunk === 'VP8X') {
    // Canvas width/height are 24-bit LE, minus one, at offset 24/27.
    return { width: readUInt24LE(bytes, 24) + 1, height: readUInt24LE(bytes, 27) + 1 }
  }
  if (chunk === 'VP8 ') {
    // Simple lossy: 3-byte start code at offset 23, then 14-bit width/height (top 2 bits are scale).
    if (bytes.length < 30 || !matches(bytes, 23, [0x9D, 0x01, 0x2A]))
      return undefined
    return { width: readUInt16LE(bytes, 26) & 0x3FFF, height: readUInt16LE(bytes, 28) & 0x3FFF }
  }
  // VP8L (lossless) uses a bit-packed header — not worth the complexity here;
  // sniffImageMime() still recognizes the file as a real webp, dimensions just
  // can't be read (the `dimensions` rule fails closed rather than guessing).
  return undefined
}

/** Reads width/height straight from the format header. `undefined` if unrecognized or malformed. */
export function readImageDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  const mime = sniffImageMime(bytes)
  switch (mime) {
    case 'image/png': return pngDimensions(bytes)
    case 'image/jpeg': return jpegDimensions(bytes)
    case 'image/gif': return gifDimensions(bytes)
    case 'image/bmp': return bmpDimensions(bytes)
    case 'image/webp': return webpDimensions(bytes)
    default: return undefined
  }
}
