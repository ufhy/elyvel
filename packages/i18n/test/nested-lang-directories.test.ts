import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { Translator } from '../src/translator'

function langDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'elyvel-lang-'))
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }
  return dir
}

/**
 * Regression: a nested lang file became the LITERAL dotted key
 * `'admin.users'`, but `resolve()` splits the lookup key on `.` and walks the
 * tree — so it looked for `admin` → `users` → `title`, found nothing, and
 * `trans('admin.users.title')` silently returned the key. Every translation in
 * a subdirectory was unreachable.
 */
describe('lang files in subdirectories are reachable', () => {
  test('a one-level subdirectory nests instead of becoming a dotted key', async () => {
    const dir = langDir({
      'en/admin/users.ts': 'export default { title: "Manage users" }',
    })

    const t = await new Translator({ locale: 'en' }).load(dir)
    expect(t.get('admin.users.title')).toBe('Manage users')
  })

  test('a deeper subdirectory works too', async () => {
    const dir = langDir({
      'en/admin/billing/invoices.ts': 'export default { heading: "Invoices" }',
    })

    const t = await new Translator({ locale: 'en' }).load(dir)
    expect(t.get('admin.billing.invoices.heading')).toBe('Invoices')
  })

  test('a nested file merges with a sibling at the same level', async () => {
    const dir = langDir({
      'en/admin/users.ts': 'export default { title: "Users" }',
      'en/admin/teams.ts': 'export default { title: "Teams" }',
    })

    const t = await new Translator({ locale: 'en' }).load(dir)
    expect(t.get('admin.users.title')).toBe('Users')
    expect(t.get('admin.teams.title')).toBe('Teams')
  })

  test('top-level group files still work exactly as before', async () => {
    const dir = langDir({
      'en/messages.ts': 'export default { welcome: "Hi" }',
      'en.ts': 'export default { bare: "Root" }',
    })

    const t = await new Translator({ locale: 'en' }).load(dir)
    expect(t.get('messages.welcome')).toBe('Hi')
    expect(t.get('bare')).toBe('Root')
  })

  test('a nested vendor override reaches the namespaced tree', async () => {
    const dir = langDir({
      'vendor/core/en/admin/errors.ts': 'export default { denied: "Nope" }',
    })

    const t = await new Translator({ locale: 'en' }).load(dir)
    expect(t.get('core::admin.errors.denied')).toBe('Nope')
  })
})
