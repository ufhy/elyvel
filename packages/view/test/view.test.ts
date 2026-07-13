import { describe, expect, test } from 'bun:test'
import { httpResponses } from '@elysia-ravel/core'
import { Elysia } from 'elysia'
import { document, escape, html, raw } from '../src/html'
import { csrfField, view, type ViewShared } from '../src/view'

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
    expect(html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`.toString()).toBe('<ul><li>a</li><li>b</li></ul>')
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

  const shared: ViewShared = { errors: {}, old: (_k, d) => d, flash: (_k, d) => d, csrf: 'tok123' }

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
    }
    const out = view(Page, { name: 'Sam' }).render(withErrors)
    expect(out).toContain('<p class="err">The email is required</p>')
    expect(out).toContain('value="a@b.com"')
  })

  test('status() sets the HTTP status', () => {
    expect(view(Page, { name: 'x' }).status(404).statusCode).toBe(404)
  })
})

// ── wired: core renders ViewResponse to text/html ─────────────────────────────
describe('view response via httpResponses', () => {
  test('handler returning view() → text/html body', async () => {
    const app = new Elysia()
      .use(httpResponses())
      .get('/', () => view((props: { who: string }) => html`<h1>Hi ${props.who}</h1>`, { who: 'World' }))

    const res = await app.handle(new Request('http://localhost/'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toBe('<h1>Hi World</h1>')
  })
})
