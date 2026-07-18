import type { ViewShared } from '../src/view'
import { httpResponses } from '@elyvel/core'
import { describe, expect, test } from 'bun:test'
import { Elysia } from 'elysia'
import { document, escape, html, raw } from '../src/html'
import { paginationLinks } from '../src/pagination'
import { csrfField, View, view } from '../src/view'

// ── html tag (escaping) ───────────────────────────────────────────────────────
describe('html tag', () => {
  test('escapes interpolated strings', () => {
    const evil = '<script>alert(1)</script>'
    expect(html`<p>${evil}</p>`.toString()).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  })
  test('passes through nested html and raw()', () => {
    const inner = html`<b>${'safe & sound'}</b>`
    expect(html`<div>${inner}</div>`.toString()).toBe('<div><b>safe &amp; sound</b></div>')
    expect(html`${raw('<hr>')}`.toString()).toBe('<hr>')
  })
  test('renders arrays element-by-element and drops null/false', () => {
    const items = ['a', 'b']
    expect(html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`.toString()).toBe(
      '<ul><li>a</li><li>b</li></ul>',
    )
    expect(html`${null}${false}${undefined}x`.toString()).toBe('x')
  })
  test('escape() and document()', () => {
    expect(escape(`a<b>"c'&`)).toBe('a&lt;b&gt;&quot;c&#39;&amp;')
    const doc = document({ title: 'Hi', body: html`<h1>Home</h1>` }).toString()
    expect(doc).toContain('<!doctype html>')
    expect(doc).toContain('<title>Hi</title>')
    expect(doc).toContain('<body><h1>Home</h1></body>')
  })
})

// ── view() rendering ──────────────────────────────────────────────────────────
describe('view()', () => {
  const Page = (props: { name: string }, shared: ViewShared) => html`
    <h1>Hello ${props.name}</h1>
    ${shared.errors.email ? html`<p class="err">${shared.errors.email[0]}</p>` : ''}
    <input value="${String(shared.old('email', ''))}" />
    ${csrfField(shared)}
  `

  const shared: ViewShared = {
    errors: {},
    old: (_k, d) => d,
    flash: (_k, d) => d,
    csrf: 'tok123',
    globals: {},
  }

  test('renders props + shared data', () => {
    const out = view(Page, { name: '<b>Sam</b>' }).render(shared)
    expect(out).toContain('Hello &lt;b&gt;Sam&lt;/b&gt;') // props escaped
    expect(out).toContain('name="_token" value="tok123"') // csrf field
  })

  test('surfaces flashed errors and old input', () => {
    const withErrors: ViewShared = {
      errors: { email: ['The email is required'] },
      old: (k, d) => (k === 'email' ? 'a@b.com' : d),
      flash: (_k, d) => d,
      csrf: 't',
      globals: {},
    }
    const out = view(Page, { name: 'Sam' }).render(withErrors)
    expect(out).toContain('<p class="err">The email is required</p>')
    expect(out).toContain('value="a@b.com"')
  })

  test('status() sets the HTTP status', () => {
    expect(view(Page, { name: 'x' }).status(404).statusCode).toBe(404)
  })
})

// ── View.share globals ────────────────────────────────────────────────────────
describe('View.share', () => {
  test('shared globals (value + lazy) are merged into every view', () => {
    View.flushShared()
    View.share('appName', 'Elyvel')
    View.share('now', () => 'computed')
    const out = view(
      (_p, s) => html`<span>${String(s.globals.appName)}:${String(s.globals.now)}</span>`,
    ).render({
      errors: {},
      old: (_k, d) => d,
      flash: (_k, d) => d,
      csrf: '',
    })
    expect(out).toBe('<span>Elyvel:computed</span>')
    View.flushShared()
  })
})

// ── pagination links ──────────────────────────────────────────────────────────
describe('paginationLinks', () => {
  test('windowed page links with prev/next state', () => {
    const out = paginationLinks(
      { currentPage: 3, lastPage: 5 },
      { path: '/users', window: 1 },
    ).toString()
    expect(out).toContain('href="/users?page=2">&laquo; Previous')
    expect(out).toContain('aria-current="page">3') // active current page, no link
    expect(out).toContain('href="/users?page=4">Next &raquo;')
    expect(out).not.toContain('page=6') // capped at lastPage
  })
  test('disables prev on first page and next on last', () => {
    const first = paginationLinks({ currentPage: 1, lastPage: 3 }).toString()
    expect(first).toContain('<span class="page disabled">&laquo; Previous')
    const last = paginationLinks({ currentPage: 3, lastPage: 3 }).toString()
    expect(last).toContain('<span class="page disabled">Next &raquo;')
  })
})

// ── wired: core renders ViewResponse to text/html ─────────────────────────────
describe('view response via httpResponses', () => {
  test('handler returning view() → text/html body', async () => {
    const app = new Elysia()
      .use(httpResponses())
      .get('/', () =>
        view((props: { who: string }) => html`<h1>Hi ${props.who}</h1>`, { who: 'World' }))

    const res = await app.handle(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toBe('<h1>Hi World</h1>')
  })
})
