/**
 * A pre-escaped, safe-to-embed HTML fragment. Values wrapped in `Html` are
 * inserted verbatim by the {@link html} tag; everything else is escaped.
 */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\'': '&#39;',
}

/** Escape a string for safe HTML text/attribute interpolation. */
export function escape(value: string): string {
  return value.replace(/[&<>"']/g, c => ESCAPES[c] as string)
}

/** Mark a string as trusted HTML (opt out of escaping). Use with care. */
export function raw(value: string): Html {
  return new Html(value)
}

function render(value: unknown): string {
  if (value == null || value === false || value === true)
    return ''
  if (value instanceof Html)
    return value.value
  if (Array.isArray(value))
    return value.map(render).join('')
  if (typeof value === 'string')
    return escape(value)
  // Any iterable, not just arrays. `Model.query().get()` returns a `Collection`,
  // and `Collection.map()` returns another one — so the idiomatic
  // `${users.map(u => html`<li>…</li>`)}` rendered `[object Object]`. Same for
  // `Set` and generators.
  if (typeof (value as { [Symbol.iterator]?: unknown })?.[Symbol.iterator] === 'function')
    return [...(value as Iterable<unknown>)].map(render).join('')
  return escape(String(value))
}

/**
 * Tagged template for building HTML safely. Interpolations are escaped unless
 * they are {@link Html} (e.g. from a nested `html` fragment or {@link raw}).
 * Arrays are rendered element-by-element, so `${items.map(i => html`...`)}` works.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0] ?? ''
  for (let i = 0; i < values.length; i++) {
    out += render(values[i]) + (strings[i + 1] ?? '')
  }
  return new Html(out)
}

/** Wrap body content in a full HTML document. */
export function document(options: {
  title?: string
  head?: Html | string
  body: Html | string
  lang?: string
}): Html {
  const head
    = options.head instanceof Html ? options.head.value : options.head ? escape(options.head) : ''
  const body = options.body instanceof Html ? options.body.value : escape(String(options.body))
  return new Html(
    `<!doctype html><html lang="${escape(options.lang ?? 'en')}"><head>`
    + `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `${options.title ? `<title>${escape(options.title)}</title>` : ''}${head}`
    + `</head><body>${body}</body></html>`,
  )
}
