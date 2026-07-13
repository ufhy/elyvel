import { type Html, html } from './html'

/** Data shared into every view by the framework (from the session). */
export interface ViewShared {
  /** Flashed validation errors from the previous request. */
  errors: Record<string, string[]>
  /** Old input for repopulating forms: `old('email', '')`. */
  old: (key: string, fallback?: unknown) => unknown
  /** Any flashed session value (e.g. a success message): `flash('status')`. */
  flash: (key: string, fallback?: unknown) => unknown
  /** The CSRF token — embed with `csrfField(shared)` inside a form. */
  csrf: string
}

/** A view template: given props (and shared session data) it returns HTML. */
export type ViewTemplate<P> = (props: P, shared: ViewShared) => Html | string

/**
 * A rendered-view response. Returned from a handler; the framework's response
 * normalizer builds {@link ViewShared} from the session and sends `text/html`.
 * Duck-typed via `__ravelView` so core stays decoupled from this package.
 */
export class ViewResponse<P> {
  readonly __ravelView = true
  private httpStatus = 200

  constructor(
    private readonly template: ViewTemplate<P>,
    private readonly props: P,
  ) {}

  status(status: number): this {
    this.httpStatus = status
    return this
  }
  get statusCode(): number {
    return this.httpStatus
  }

  /** Render to an HTML string with the framework-provided shared data. */
  render(shared: ViewShared): string {
    return String(this.template(this.props, shared))
  }
}

/** Render a view template with props (Laravel's `view()`). */
export function view<P = Record<string, never>>(template: ViewTemplate<P>, props: P = {} as P): ViewResponse<P> {
  return new ViewResponse(template, props)
}

/** A hidden `_token` input for CSRF-protected forms. */
export function csrfField(shared: ViewShared): Html {
  return html`<input type="hidden" name="_token" value="${shared.csrf}" />`
}

/** A hidden `_method` input to spoof PUT/PATCH/DELETE from an HTML form. */
export function methodField(method: string): Html {
  return html`<input type="hidden" name="_method" value="${method.toUpperCase()}" />`
}
