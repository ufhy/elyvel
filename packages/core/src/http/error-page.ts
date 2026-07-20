/**
 * Framework default error pages (à la Laravel's `resources/views/errors/*`).
 * A self-contained, dependency-free HTML page — works for any app, styled to
 * match the scaffold's landing (dark, indigo accent, faint grid). The core
 * error handler renders this for browser navigations; API clients get JSON.
 */
import { readFileSync } from 'node:fs'
import { trans } from '@elyvel/support'

interface ErrorMeta {
  title: string
  message: string
}

/** A view response (from `@elyvel/view`), duck-typed so core stays decoupled. */
export interface RenderableView {
  __elyvelView: true
  statusCode?: number
  render(shared: Record<string, unknown>): string
}

/** What a custom error-page resolver may return. `undefined` → use the default page. */
export type ErrorPageResult = string | Response | RenderableView | undefined | null

export interface ErrorPageContext {
  /** The incoming request (already known to want HTML — resolvers are never called for JSON). */
  request: Request
  /** A safe, human message for this error (4xx only; undefined for 5xx). */
  message?: string
  /** The underlying error/exception, if any. */
  error: unknown
  /** The active session, if the session plugin is mounted (for view shared data). */
  session?: unknown
}

/**
 * Resolve a custom page for an HTTP error. Return HTML, a `Response`, a
 * `view(...)` result, or `undefined` to fall back to the framework default.
 * ONLY called for browser/web navigations — API/JSON clients always get JSON.
 */
export type ErrorPageResolver = (
  status: number,
  context: ErrorPageContext,
) => ErrorPageResult | Promise<ErrorPageResult>

let customResolver: ErrorPageResolver | null = null

/**
 * Provide custom error pages (à la publishing Laravel's `resources/views/errors`).
 * Wire it in a service provider:
 *
 *   configureErrorPage((status, { message }) =>
 *     status === 404 ? view('errors/404', { message }) : undefined)
 */
export function configureErrorPage(resolver: ErrorPageResolver | null): void {
  customResolver = resolver
}

/** The configured custom resolver, or null. Used by the error-pages plugin. */
export function errorPageResolver(): ErrorPageResolver | null {
  return customResolver
}

const DEFAULTS: Record<number, ErrorMeta> = {
  400: { title: 'Bad Request', message: 'The server could not understand this request.' },
  401: { title: 'Unauthorized', message: 'You need to sign in to continue.' },
  403: { title: 'Forbidden', message: 'You don’t have permission to access this page.' },
  404: { title: 'Page Not Found', message: 'The page you’re looking for doesn’t exist.' },
  419: { title: 'Page Expired', message: 'Your session has expired — please refresh and try again.' },
  422: { title: 'Unprocessable', message: 'The submitted data could not be processed.' },
  429: { title: 'Too Many Requests', message: 'Slow down a little and try again shortly.' },
  500: { title: 'Server Error', message: 'Something went wrong on our end.' },
  503: { title: 'Service Unavailable', message: 'We’re down for a moment — back shortly.' },
}

/**
 * Canonical English defaults for the `errors` translation group — the status
 * pages plus the short JSON messages core itself emits. `elyvel lang:publish`
 * dumps this to `lang/<locale>/errors.ts` so it can be restyled/translated.
 * Auth-specific messages (unauthenticated/unverified/unauthorized) live in
 * `@elyvel/auth`'s own `lang/` namespace instead — core doesn't own them.
 */
export const ERROR_LANG_DEFAULTS: Record<string, ErrorMeta | string> = {
  ...DEFAULTS,
  throttle: 'Too Many Requests',
  csrf: 'CSRF token mismatch.',
  not_found: ':resource not found',
}

/** Translated title/message for a status, falling back to the built-in English. */
function errorMeta(status: number): ErrorMeta {
  const fallback = DEFAULTS[status] ?? { title: 'Error', message: 'An unexpected error occurred.' }
  return {
    title: trans(`errors.${status}.title`, {}, fallback.title),
    message: trans(`errors.${status}.message`, {}, fallback.message),
  }
}

/** A human-readable default message for a status (for JSON error bodies). */
export function defaultErrorMessage(status: number): string {
  return errorMeta(status).message
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** One parsed `    at fn (file:line:col)` stack frame. */
interface StackFrame {
  raw: string
  /** Frames inside node_modules/Bun/Node internals are dimmed, not the focus. */
  isAppCode: boolean
}

function parseStack(stack: string): { header: string, frames: StackFrame[] } {
  const lines = stack.split('\n')
  const header = lines[0] ?? 'Error'
  const frames = lines.slice(1)
    .map(line => line.trim())
    .filter(Boolean)
    .map(raw => ({
      raw,
      isAppCode: !raw.includes('node_modules') && !raw.includes('(native:') && !raw.includes('(unknown)'),
    }))
  return { header, frames }
}

/** Pulls `file:line:col` out of a stack frame like `at fn (/path/to/file.ts:19:38)`. */
function frameLocation(raw: string): { file: string, line: number } | undefined {
  const match = raw.match(/\(?([^\s()]+):(\d+):(\d+)\)?\s*$/)
  if (!match)
    return undefined
  const [, file, line] = match
  return { file: file!, line: Number(line) }
}

/** A few lines of source around `line` (1-indexed), the failing line marked — à la Laravel's debug page. */
function codeSnippet(file: string, line: number, radius = 5): { startLine: number, lines: string[], failingIndex: number } | undefined {
  try {
    const source = readFileSync(file, 'utf8').split('\n')
    const start = Math.max(0, line - 1 - radius)
    const end = Math.min(source.length, line + radius)
    return { startLine: start + 1, lines: source.slice(start, end), failingIndex: line - 1 - start }
  }
  catch {
    return undefined
  }
}

/** The same facts shown on the HTML debug page, shaped for a JSON debug response. */
export interface DebugInfo {
  exception: string
  message: string
  file?: string
  line?: number
  stack?: string
}

/**
 * Extract debug facts from an uncaught error — exception class name, message,
 * and the first app-code frame's file/line (the dependency that actually
 * threw is often less useful than where the app called into it). Shared by
 * {@link renderDebugPage} (HTML) and the JSON debug response.
 */
export function debugInfo(error: unknown): DebugInfo {
  const message = error instanceof Error ? error.message : String(error)
  const exception = error instanceof Error ? error.name : 'Error'
  const stack = error instanceof Error ? error.stack : undefined
  const { frames } = stack ? parseStack(stack) : { frames: [] as StackFrame[] }
  const location = frameLocation(frames.find(f => f.isAppCode)?.raw ?? '')
  return { exception, message, file: location?.file, line: location?.line, stack }
}

/**
 * A debug page for an uncaught error — the message, a stack trace (app-code
 * frames highlighted, framework/dependency frames dimmed), and the request
 * that triggered it. Shown instead of {@link renderErrorPage} for 500s when
 * `config('app.debug')` is on — NEVER in production (see `AppConfig.debug`).
 */
export function renderDebugPage(options: { method: string, url: string, error: unknown }): string {
  const error = options.error
  const message = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : 'Error'
  const stack = error instanceof Error && error.stack ? error.stack : undefined
  const { frames } = stack ? parseStack(stack) : { frames: [] as StackFrame[] }

  const frameRows = frames.length > 0
    ? frames.map(f => `<div class="frame${f.isAppCode ? ' app' : ''}">${escapeHtml(f.raw)}</div>`).join('')
    : '<div class="frame">No stack trace available.</div>'

  // The first app-code frame is the most actionable place to show source —
  // the literal throw site is often deep in a dependency (dayjs, Elysia…).
  const appFrame = frames.find(f => f.isAppCode)
  const location = appFrame ? frameLocation(appFrame.raw) : undefined
  const snippet = location ? codeSnippet(location.file, location.line) : undefined
  const snippetHtml = snippet
    ? `<div class="snippet-path">${escapeHtml(location!.file)}:${location!.line}</div>`
    + `<div class="snippet">${
      snippet.lines.map((codeLine, i) => {
        const lineNo = snippet.startLine + i
        const isFailing = i === snippet.failingIndex
        return `<div class="code-line${isFailing ? ' failing' : ''}">`
          + `<span class="line-no">${lineNo}</span>`
          + `<span class="code">${escapeHtml(codeLine)}</span>`
          + `</div>`
      }).join('')
    }</div>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>500 · ${escapeHtml(name)}</title>
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; margin: 0; }
  body {
    min-height: 100vh; padding: 2rem; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #e5e7eb; background: #0a0a0f;
  }
  .eyebrow {
    display: inline-block; margin-bottom: 1rem; padding: 0.3rem 0.8rem; border-radius: 9999px;
    border: 1px solid rgba(248,113,113,0.3); background: rgba(248,113,113,0.08);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.72rem; color: #fca5a5;
  }
  h1 { font-size: 1.4rem; font-weight: 600; color: #fff; word-break: break-word; }
  .message { margin-top: 0.5rem; font-size: 1rem; color: #d1d5db; word-break: break-word; }
  .request {
    margin-top: 1.25rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.8rem;
    color: #9ca3af; padding: 0.6rem 0.9rem; border-radius: 0.5rem; background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08); display: inline-block;
  }
  .stack {
    margin-top: 1.5rem; border-radius: 0.6rem; border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.02); overflow-x: auto;
  }
  .frame {
    padding: 0.45rem 0.9rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.78rem; color: #6b7280; white-space: pre; border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .frame:last-child { border-bottom: none; }
  .frame.app { color: #e5e7eb; background: rgba(99,102,241,0.08); }
  .snippet-path {
    margin-top: 1.5rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.78rem; color: #9ca3af;
  }
  .snippet {
    margin-top: 0.4rem; border-radius: 0.6rem; border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.02); overflow-x: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.8rem;
  }
  .code-line { display: flex; white-space: pre; }
  .code-line.failing { background: rgba(248,113,113,0.12); }
  .line-no {
    flex-shrink: 0; width: 3.2rem; padding: 0.15rem 0.75rem; text-align: right; color: #4b5563; user-select: none;
    border-right: 1px solid rgba(255,255,255,0.06);
  }
  .code-line.failing .line-no { color: #fca5a5; font-weight: 600; }
  .code { padding: 0.15rem 0.9rem; color: #d1d5db; }
  .code-line.failing .code { color: #fecaca; }
  .hint { margin-top: 1.25rem; font-size: 0.8rem; color: #6b7280; }
  @media (prefers-color-scheme: light) {
    body { color: #1f2937; background: #f8fafc; }
    h1 { color: #0f172a; }
    .message { color: #374151; }
    .request { color: #4b5563; background: rgba(0,0,0,0.03); border-color: rgba(0,0,0,0.08); }
    .stack { border-color: rgba(0,0,0,0.08); background: rgba(0,0,0,0.015); }
    .frame { color: #9ca3af; border-color: rgba(0,0,0,0.05); }
    .frame.app { color: #111827; background: rgba(79,70,229,0.06); }
    .snippet-path { color: #6b7280; }
    .snippet { border-color: rgba(0,0,0,0.08); background: rgba(0,0,0,0.015); }
    .line-no { color: #9ca3af; border-color: rgba(0,0,0,0.06); }
    .code { color: #1f2937; }
    .code-line.failing { background: rgba(220,38,38,0.08); }
    .code-line.failing .line-no { color: #b91c1c; }
    .code-line.failing .code { color: #991b1b; }
  }
</style>
</head>
<body>
  <div class="eyebrow">Error 500 · dev-only debug page</div>
  <h1>${escapeHtml(name)}</h1>
  <p class="message">${escapeHtml(message)}</p>
  <div class="request">${escapeHtml(options.method)} ${escapeHtml(options.url)}</div>
  ${snippetHtml}
  <div class="stack">${frameRows}</div>
  <p class="hint">Shown because <code>app.debug</code> is on (default outside production) — never shown in production.</p>
</body>
</html>`
}

/** A complete, styled HTML document for an HTTP error status. */
export function renderErrorPage(status: number, options: { message?: string } = {}): string {
  const meta = errorMeta(status)
  const title = escapeHtml(meta.title)
  const message = escapeHtml(options.message?.trim() || meta.message)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${status} · ${title}</title>
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; margin: 0; }
  body {
    min-height: 100vh; display: grid; place-items: center; padding: 2rem;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #e5e7eb; background: #0a0a0f; position: relative; overflow: hidden;
  }
  .glow {
    position: fixed; top: -30%; left: 50%; transform: translateX(-50%);
    width: 40rem; height: 40rem; border-radius: 9999px;
    background: rgba(99, 102, 241, 0.18); filter: blur(120px); pointer-events: none;
  }
  .grid {
    position: fixed; inset: 0; pointer-events: none; opacity: 0.05;
    background-image: linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px);
    background-size: 56px 56px;
    -webkit-mask-image: radial-gradient(ellipse 80% 55% at 50% 0%, #000 40%, transparent 100%);
    mask-image: radial-gradient(ellipse 80% 55% at 50% 0%, #000 40%, transparent 100%);
  }
  main { position: relative; text-align: center; max-width: 34rem; }
  .code {
    font-size: clamp(7rem, 22vw, 12rem); font-weight: 800; line-height: 1; letter-spacing: -0.05em;
    background: linear-gradient(180deg, #a5b4fc, #4f46e5); -webkit-background-clip: text;
    background-clip: text; color: transparent; user-select: none;
  }
  .eyebrow {
    display: inline-block; margin-bottom: 1.25rem; padding: 0.3rem 0.8rem; border-radius: 9999px;
    border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.72rem; color: #a5b4fc;
  }
  h1 { margin: 0.75rem 0 0.5rem; font-size: 1.6rem; font-weight: 600; color: #fff; letter-spacing: -0.01em; }
  p { color: #9ca3af; line-height: 1.6; }
  a.home {
    display: inline-block; margin-top: 2rem; padding: 0.65rem 1.3rem; border-radius: 0.6rem;
    background: #4f46e5; color: #fff; text-decoration: none; font-size: 0.9rem; font-weight: 600;
    transition: background 0.15s;
  }
  a.home:hover { background: #6366f1; }
  @media (prefers-color-scheme: light) {
    body { color: #1f2937; background: #f8fafc; }
    .grid { opacity: 0.05; background-image: linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px); }
    h1 { color: #0f172a; }
    p { color: #6b7280; }
  }
</style>
</head>
<body>
  <div class="glow"></div>
  <div class="grid"></div>
  <main>
    <div class="eyebrow">Error ${status}</div>
    <div class="code">${status}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <a class="home" href="/">← Back home</a>
  </main>
</body>
</html>`
}
