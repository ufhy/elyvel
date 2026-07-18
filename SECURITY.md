# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately via GitHub's [Security Advisories](../../security/advisories/new)
(preferred) or by email to the maintainers. Include:

- affected package(s) and version(s),
- a description and impact assessment,
- reproduction steps or a proof of concept.

We aim to acknowledge a report within 72 hours, agree on a disclosure timeline,
and credit reporters who wish to be named once a fix ships.

## Supported versions

elyvel is **pre-1.0** (see [CONTRIBUTING.md](./CONTRIBUTING.md#versioning--stability)).
Only the latest published version receives security fixes until 1.0.

## Built-in protections

The framework ships secure defaults for the common web risks:

- **SQL injection** — the query builder and Eloquent layer always send values as
  bound parameters (dialect placeholders); user input is never interpolated into SQL.
- **Password storage** — handled by Better Auth (`@elyvel/auth`); passwords
  are hashed, never stored or logged in plaintext.
- **Session cookies** — `httpOnly` and `SameSite=Lax` by default, signed with
  `app.key` / `session.secret`.
- **Rate limiting** — the `throttle` middleware and named limiters guard against
  brute force and abuse.
- **Mass-assignment control** — `$fillable` / `$guarded` on models.
- **CSRF protection** — the `csrf` middleware validates tokens on state-changing
  requests when sessions are enabled.
- **Log redaction** — the logger redacts configured secret keys/patterns.

## Hardening checklist (production)

These are **not all on by default** — review them before you deploy:

- [ ] Set a strong `APP_KEY` (`elyvel key:generate`) — required for signed cookies
      and `encrypted` model casts.
- [ ] Enable secure cookies: `session.secure = true` (HTTPS-only) in production.
- [ ] Route browser/session traffic through the built-in **`web` group**
      (`route().use(group('web'))`), which applies CSRF. It's a group, not a
      global — API/token routes are CSRF-immune and stay out of it. Requires
      sessions enabled.
- [ ] Protect mass-assignment: set `fillable` (or `guarded`) on every model that
      is filled from request input. **Models are unguarded by default** — with an
      empty `fillable` every column is mass-assignable. Note this is *less strict
      than Laravel*, which guards by default and rejects mass-assignment until you
      declare `fillable`. Until that default is reconsidered, treat declaring
      `fillable` as mandatory for any model bound to request input.
- [ ] Apply `throttle` to authentication and other sensitive routes.
- [ ] Disable OpenAPI docs in production unless intentionally public
      (`config('openapi.enabled') = false`; already off by default outside dev).
- [ ] Run behind HTTPS and set `session.domain` / cookie scoping appropriately.
- [ ] Keep `APP_ENV=production` so verbose error pages and dev-only surfaces stay off.
