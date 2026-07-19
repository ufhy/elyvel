import { sniffImageMime } from './image-inspect'

/**
 * Content-sniffing for `mimes`/`mimetypes`, beyond just images. Same rationale
 * as `image-inspect.ts`: don't trust the browser-supplied `Blob.type` or the
 * filename extension for formats we can actually verify from magic bytes.
 *
 * Only covers formats with a real, checkable binary signature (images + PDF).
 * Plain-text-ish formats (csv/txt/json/svg) have no such signature — any text
 * file can freely claim to be any other text file — so callers should fall
 * back to the declared type/extension for anything this returns `undefined`
 * for, exactly like before this existed.
 */
export function sniffFileMime(bytes: Uint8Array): string | undefined {
  const image = sniffImageMime(bytes)
  if (image)
    return image
  const PDF_SIG = [0x25, 0x50, 0x44, 0x46, 0x2D] // "%PDF-"
  if (bytes.length >= PDF_SIG.length && PDF_SIG.every((byte, i) => bytes[i] === byte))
    return 'application/pdf'
  return undefined
}
