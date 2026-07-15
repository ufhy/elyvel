/** A file path, in-memory bytes/text, or a stream to send as the response body. */
export type FileSource = string | Uint8Array | ArrayBuffer | ReadableStream | AsyncIterable<unknown>

export interface FileOptions {
  /** Download filename (sets `Content-Disposition`). */
  name?: string
  /** Override the content type (inferred from the path otherwise). */
  contentType?: string
  disposition: 'attachment' | 'inline'
  /** True when `source` is a filesystem path (read via Bun.file), false for in-memory/stream. */
  fromPath: boolean
}

/**
 * A file/download/stream response (Laravel's `response()->file()/download()`).
 * Normalized by the {@link httpResponses} plugin into a Bun.file/stream body
 * with the right `Content-Type` and `Content-Disposition`.
 */
export class FileResponse {
  readonly __ravelFile = true
  constructor(
    readonly source: FileSource,
    readonly options: FileOptions,
  ) {}
}

/** Serve a file (by path) inline — rendered in the browser when possible. */
export function file(
  path: string,
  options: { contentType?: string; name?: string } = {},
): FileResponse {
  return new FileResponse(path, { disposition: 'inline', fromPath: true, ...options })
}

/** Send a file (by path) as a download; the filename defaults to the path's basename. */
export function download(
  path: string,
  name?: string,
  options: { contentType?: string } = {},
): FileResponse {
  return new FileResponse(path, { disposition: 'attachment', fromPath: true, name, ...options })
}

/** Send in-memory content, bytes, or a stream as a download (e.g. a generated CSV). */
export function streamDownload(
  name: string,
  source: string | Uint8Array | ArrayBuffer | ReadableStream | AsyncIterable<unknown>,
  options: { contentType?: string } = {},
): FileResponse {
  return new FileResponse(source, {
    disposition: 'attachment',
    fromPath: false,
    name,
    contentType: options.contentType ?? 'application/octet-stream',
  })
}
