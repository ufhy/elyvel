/** A key/value pair flashed to the session for the next request. */
interface Flash {
  key: string
  value: unknown
}

/** Minimal session surface a redirect needs (duck-typed to avoid a hard import). */
interface FlashableSession {
  flash(key: string, value: unknown): void
}

/**
 * A pending redirect returned from a handler (Laravel's `redirect()`).
 * `back()` resolves to the `Referer`; `withErrors`/`withInput`/`with` flash
 * data to the session for the next request. The {@link httpResponses} plugin
 * turns it into a real 303 response and applies the flashes.
 */
export class RedirectResponse {
  status = 303
  private target: string | 'back'
  private readonly flashes: Flash[] = []

  constructor(target: string | 'back' = '/') {
    this.target = target
  }

  to(url: string): this {
    this.target = url
    return this
  }

  back(): this {
    this.target = 'back'
    return this
  }

  /** Set the HTTP status (e.g. 301 for permanent). */
  withStatus(status: number): this {
    this.status = status
    return this
  }

  with(key: string, value: unknown): this {
    this.flashes.push({ key, value })
    return this
  }

  /** Flash validation errors (read next request as `errors`). */
  withErrors(errors: Record<string, unknown>): this {
    return this.with('errors', errors)
  }

  /** Flash the old input so a form can be re-populated (read as `_old_input`). */
  withInput(input: Record<string, unknown>): this {
    return this.with('_old_input', input)
  }

  /** Resolve the destination URL (`back` → Referer, else the target). */
  location(request: Request): string {
    if (this.target !== 'back')
      return this.target
    return request.headers.get('referer') ?? '/'
  }

  /** Apply the pending flashes to the session (no-op without one). */
  applyFlash(session: FlashableSession | undefined): void {
    if (!session)
      return
    for (const flash of this.flashes) session.flash(flash.key, flash.value)
  }
}

/** Redirect to `url` (Laravel's `redirect($url)`). */
export function redirect(url = '/'): RedirectResponse {
  return new RedirectResponse(url)
}

/** Redirect back to the previous page (Laravel's `back()`). */
export function back(): RedirectResponse {
  return new RedirectResponse('back')
}
