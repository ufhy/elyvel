import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { ERROR_LANG_DEFAULTS } from '@elyvel/core'
import { DEFAULT_MESSAGES } from '@elyvel/validation'
import { comment, error, info, line } from '../io'

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
  mkdirSync(dir, { recursive: true })
  const banner = `// Published by \`elyvel lang:publish\`. Edit freely — restyle the wording or\n`
    + `// translate the values; keys are matched by the framework.\n\n`
  const contents = `${banner}export default ${toTsLiteral(data)}\n`

  // `wx` fails when the file already exists, so "don't clobber" is one atomic
  // decision by the filesystem rather than an existsSync the write can lose a
  // race with. Without --force, a file that appeared in between is still safe.
  try {
    writeFileSync(file, contents, { encoding: 'utf8', flag: force ? 'w' : 'wx' })
  }
  catch (error) {
    if ((error as { code?: string }).code === 'EEXIST') {
      comment(`  • skipped ${rel} (exists — use --force)`)
      return false
    }
    throw error
  }
  info(`  ✓ ${rel}`)
  return true
}

/**
 * `elyvel lang:publish --package=<name> [--force]` — copy an installed
 * `@elyvel/*` package's own bundled `lang/` directory (its namespaced
 * defaults — see `I18nServiceProvider`'s auto-discovery) into
 * `lang/vendor/<name>/`, Laravel's `vendor:publish` for translations. Lets
 * you edit every line the package ships, not just override specific keys.
 */
function publishPackageLang(pkgName: string, force: boolean): number {
  const src = join(process.cwd(), 'node_modules', '@elyvel', pkgName, 'lang')
  if (!existsSync(src)) {
    error(`✗ No lang/ directory found for @elyvel/${pkgName} (node_modules/@elyvel/${pkgName}/lang).`)
    return 1
  }
  const dest = join(process.cwd(), 'lang', 'vendor', pkgName)
  if (existsSync(dest) && !force) {
    comment(`  • skipped ${relative(process.cwd(), dest)}/ (exists — use --force)`)
    return 0
  }
  mkdirSync(join(process.cwd(), 'lang', 'vendor'), { recursive: true })
  cpSync(src, dest, { recursive: true, force: true })
  info(`✓ Published @elyvel/${pkgName}'s lang/ to ${relative(process.cwd(), dest)}/`)
  return 0
}

/**
 * `elyvel lang:publish [locale] [--force]` — dump the framework's built-in message
 * defaults (validation + errors) so they can be restyled or translated. Existing
 * files are left alone unless `--force`. `--package=<name>` instead copies an
 * installed package's own bundled `lang/` directory (see {@link publishPackageLang}).
 */
export function langPublish(
  locale = 'en',
  flags: Record<string, string | boolean> = {},
): number {
  if (typeof flags.package === 'string')
    return publishPackageLang(flags.package, flags.force === true)

  const force = flags.force === true

  line(`Publishing default messages to lang/vendor/`)
  // Both validation::* and core::errors.* are namespaced (auto-loaded from
  // their own packages' lang/ — see I18nServiceProvider) — override location
  // is lang/vendor/<namespace>/..., not a plain lang/<locale>/ file. Every
  // trans() call in the framework's own source is namespaced this way now;
  // there's no more app-level "default" translation group.
  writeGroup(join(process.cwd(), 'lang', 'vendor', 'validation'), locale, DEFAULT_MESSAGES, force)
  writeGroup(join(process.cwd(), 'lang', 'vendor', 'core', locale), 'errors', ERROR_LANG_DEFAULTS, force)
  line(`\nDone. Edit the published files to change the wording; add the locale to config/i18n.ts \`locales\`.`)
  return 0
}
