import { describe, expect, test } from 'bun:test'
import { html, raw } from '../src/html'
import { view } from '../src/view'

/** Minimal stand-in for `@elyvel/support`'s Collection: iterable, no toString. */
class FakeCollection<T> {
  constructor(private readonly items: T[]) {}
  * [Symbol.iterator](): Iterator<T> {
    yield* this.items
  }

  map<R>(fn: (item: T) => R): FakeCollection<R> {
    return new FakeCollection([...this].map(fn))
  }
}

/**
 * Regression: `ViewTemplate` accepted `Html | string` and `render()` did
 * `String(template(...))`, so a template returning a plain template literal was
 * emitted VERBATIM. `html\`…\`` and a bare backtick literal are one character
 * apart, making this a straight XSS on a typo. `document()` already escaped a
 * plain string — this path disagreed with it.
 */
describe('a view template returning a plain string is escaped, not trusted', () => {
  test('a bare template literal is escaped', () => {
    const response = view(((props: { name: string }) => `<h1>${props.name}</h1>`) as any, {
      name: '<script>alert(1)</script>',
    })
    const out = response.render({} as any)
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  test('an html`` template still emits real markup and escapes its props', () => {
    const response = view((props: { name: string }) => html`<h1>${props.name}</h1>`, {
      name: '<script>alert(1)</script>',
    })
    const out = response.render({} as any)
    expect(out).toStartWith('<h1>')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  test('raw() remains the explicit opt-out', () => {
    expect(view(() => raw('<b>trusted</b>'), {}).render({} as any)).toBe('<b>trusted</b>')
  })
})

/**
 * Regression: `render()` expanded only `Array.isArray`, so any other iterable
 * fell through to `String(value)`. `Model.query().get()` returns a Collection
 * and `Collection.map()` returns another one, so the idiomatic
 * `${users.map(u => html`<li>…</li>`)}` rendered `[object Object]`.
 */
describe('html`` expands any iterable, not just arrays', () => {
  test('a Collection of fragments renders element-by-element', () => {
    const users = new FakeCollection([{ name: 'Ada' }, { name: '<script>' }])
    const out = html`<ul>${users.map(u => html`<li>${u.name}</li>`)}</ul>`.value
    expect(out).toBe('<ul><li>Ada</li><li>&lt;script&gt;</li></ul>')
    expect(out).not.toContain('[object Object]')
  })

  test('a Set of plain strings is expanded and each element escaped', () => {
    expect(html`${new Set(['a', '<b>'])}`.value).toBe('a&lt;b&gt;')
  })

  test('a generator is expanded', () => {
    function* rows(): Generator<unknown> {
      yield html`<td>1</td>`
      yield html`<td>2</td>`
    }
    expect(html`<tr>${rows()}</tr>`.value).toBe('<tr><td>1</td><td>2</td></tr>')
  })

  test('arrays and non-iterables are unchanged', () => {
    expect(html`${['a', '<b>']}`.value).toBe('a&lt;b&gt;')
    expect(html`${{ a: 1 }}`.value).toBe('[object Object]')
    expect(html`${42}`.value).toBe('42')
    expect(html`${null}${undefined}${false}`.value).toBe('')
  })
})
