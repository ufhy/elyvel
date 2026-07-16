/**
 * Framework default error pages (à la Laravel's `resources/views/errors/*`).
 * A self-contained, dependency-free HTML page — works for any app, styled to
 * match the scaffold's landing (dark, indigo accent, faint grid). The core
 * error handler renders this for browser navigations; API clients get JSON.
 */

interface ErrorMeta {
  title: string
  message: string
}

/** A view response (from `@elysia-ravel/view`), duck-typed so core stays decoupled. */
export interface RenderableView {
  __ravelView: true
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

/** A human-readable default message for a status (for JSON error bodies). */
export function defaultErrorMessage(status: number): string {
  return DEFAULTS[status]?.message ?? 'An unexpected error occurred.'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A complete, styled HTML document for an HTTP error status. */
export function renderErrorPage(status: number, options: { message?: string } = {}): string {
  const meta = DEFAULTS[status] ?? { title: 'Error', message: 'An unexpected error occurred.' }
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
