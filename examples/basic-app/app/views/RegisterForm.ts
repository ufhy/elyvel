import type { ViewShared } from '@elysia-ravel/view'
import { csrfField, document, html } from '@elysia-ravel/view'

/** A server-rendered registration form that shows flashed errors + old input. */
export function RegisterForm(_props: Record<string, never>, shared: ViewShared) {
  const error = (field: string) =>
    shared.errors[field] ? html`<small class="error">${shared.errors[field]?.[0]}</small>` : ''

  return document({
    title: 'Register',
    body: html`
      <main style="max-width:24rem;margin:3rem auto;font-family:sans-serif">
        <h1>Create account</h1>
        ${shared.flash('status') ? html`<p class="ok">${shared.flash('status')}</p>` : ''}
        <form method="post" action="/register">
          ${csrfField(shared)}
          <label>Name <input name="name" value="${String(shared.old('name', ''))}" /></label>
          ${error('name')}
          <label>Email <input name="email" value="${String(shared.old('email', ''))}" /></label>
          ${error('email')}
          <label>Password <input type="password" name="password" /></label>
          ${error('password')}
          <button type="submit">Register</button>
        </form>
      </main>
    `,
  })
}
