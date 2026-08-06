/**
 * Composes the agent guidelines for ONE app: the always-on sections plus a
 * section per installed @elyvel package, stamped with the exact installed
 * versions — Laravel Boost's GuidelineComposer, without a template engine.
 * The sections themselves are plain markdown in this package's `guidelines/`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { installedElyvelPackages } from '../packages'

const GUIDELINES_DIR = join(import.meta.dir, '..', '..', 'guidelines')

interface Section {
  file: string
  /** Only include when this package is installed. Omit for always-on sections. */
  requires?: string
}

/** Order matters — this is reading order for the agent. */
const SECTIONS: Section[] = [
  { file: 'foundation.md' },
  { file: 'boost.md' },
  { file: 'core.md' },
  { file: 'database.md', requires: '@elyvel/database' },
  { file: 'validation.md', requires: '@elyvel/validation' },
  { file: 'queue.md', requires: '@elyvel/queue' },
  { file: 'inertia.md', requires: '@elyvel/inertia' },
  { file: 'vite.md', requires: '@elyvel/vite' },
  { file: 'testing.md', requires: '@elyvel/testing' },
]

/** The composed guidelines and which section files made it in. */
export interface ComposedGuidelines {
  content: string
  used: string[]
}

export function composeGuidelines(cwd: string): ComposedGuidelines {
  const installed = new Set(installedElyvelPackages(cwd).map(p => p.name))
  const used: string[] = []
  const parts: string[] = []

  for (const section of SECTIONS) {
    if (section.requires && !installed.has(section.requires))
      continue
    const path = join(GUIDELINES_DIR, section.file)
    if (!existsSync(path))
      continue
    parts.push(readFileSync(path, 'utf8').trim())
    used.push(section.file)

    // The foundation section is the natural home for the version listing.
    if (section.file === 'foundation.md')
      parts.push(versionBlock(cwd))
  }

  return { content: `${parts.filter(Boolean).join('\n\n')}\n`, used }
}

function versionBlock(cwd: string): string {
  const packages = installedElyvelPackages(cwd)
  if (packages.length === 0)
    return ''
  return [
    '### Installed @elyvel packages',
    '',
    'Use the APIs matching these exact versions — do not assume:',
    '',
    ...packages.map(p => `- ${p.name}@${p.version}`),
  ].join('\n')
}
