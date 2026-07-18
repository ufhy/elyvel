import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ERROR_LANG_DEFAULTS } from '@elyvel/core'
import { DEFAULT_MESSAGES } from '@elyvel/validation'

/** Serialize a (nested string) object as an idiomatic TS object literal. */
function toTsLiteral(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent + 1)
  const close = '  '.repeat(indent)
  if (typeof value === 'string')
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      const k = /^[a-z_$][\w$]*$/i.test(key) || /^\d+$/.test(key) ? key : `'${key}'`
      return `${pad}${k}: ${toTsLiteral(val, indent + 1)},`
    })
    return `{\n${entries.join('\n')}\n${close}}`
  }
  return JSON.stringify(value)
}

function writeGroup(dir: string, name: string, data: unknown, force: boolean): boolean {
  const file = join(dir, `${name}.ts`)
  const rel = relative(process.cwd(), file)
  if (existsSync(file) && !force) {
    console.log(`  • skipped ${rel} (exists — use --force)`)
    return false
  }
  const banner = `// Published by \`elyvel lang:publish\`. Edit freely — restyle the wording or\n`
    + `// translate the values; keys are matched by the framework.\n\n`
  writeFileSync(file, `${banner}export default ${toTsLiteral(data)}\n`, 'utf8')
  console.log(`  ✓ ${rel}`)
  return true
}

/**
 * `elyvel lang:publish [locale] [--force]` — dump the framework's built-in message
 * defaults (validation + errors) to `lang/<locale>/` so they can be restyled or
 * translated. Existing files are left alone unless `--force`.
 */
export function langPublish(
  locale = 'en',
  flags: Record<string, string | boolean> = {},
): number {
  const force = flags.force === true
  const dir = join(process.cwd(), 'lang', locale)
  mkdirSync(dir, { recursive: true })

  console.log(`Publishing default messages to lang/${locale}/`)
  writeGroup(dir, 'validation', DEFAULT_MESSAGES, force)
  writeGroup(dir, 'errors', ERROR_LANG_DEFAULTS, force)
  console.log(`\nDone. Edit lang/${locale}/*.ts to change the wording; add the locale to config/i18n.ts \`locales\`.`)
  return 0
}
