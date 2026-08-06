# elyvel Boost Guidelines

Curated guidance for AI-assisted work on this application. Follow it closely —
it reflects how this framework actually works, not how similar frameworks work.

## Foundational context

This is an **elyvel** application: a Laravel-inspired framework built on
**Elysia** and running on **Bun** (never Node — use `bun`, `bun test`,
`bun install`, and Bun APIs where they matter). It is TypeScript end to end;
packages ship TypeScript source, not compiled JS.

elyvel follows Laravel's architecture — config in `config/`, models in
`app/models/`, routes in `routes/`, service providers, middleware groups,
Eloquent-style ORM — but it is **not Laravel and not PHP**. Never assume a
Laravel API exists here; check the installed packages and their versions below,
and verify against this codebase.

## Conventions

- Follow the existing conventions in this application first. Before creating or
  editing a file, read sibling files for structure, naming, and approach.
- Use descriptive names (`isRegisteredForDiscounts`, not `discount()`).
- Reuse existing components/helpers before writing new ones.
- Stick to the existing directory structure; don't create new base folders
  without approval, and don't add dependencies without approval.
- Only create documentation files when explicitly requested.
