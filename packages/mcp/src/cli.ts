/**
 * The `elyvel mcp:*` commands, discovered via `elyvel package:discover`.
 * This is dev tooling in the exact sense `@elyvel/cli` is: install it with
 * `bun add -d`, and nothing here is ever imported by the running server —
 * this file only runs inside the `elyvel` CLI process (or the MCP server
 * process an agent spawns, which is the same binary).
 */
import type { ConsoleCommand } from '@elyvel/core'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { comment, error, info, warn } from '@elyvel/cli'
import { createApp } from '@elyvel/core'
import { composeGuidelines } from './install/guidelines'
import { writeAgentsFile, writeMcpConfig } from './install/writers'

async function mcpInstall(): Promise<number> {
  const cwd = process.cwd()
  if (!existsSync(join(cwd, 'config'))) {
    error('This does not look like an elyvel app (no config/ directory here).')
    return 1
  }

  // This package must never ship to production — same rule as @elyvel/cli.
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    if (pkg.dependencies?.['@elyvel/mcp']) {
      warn('@elyvel/mcp is in "dependencies" — move it to devDependencies (`bun add -d @elyvel/mcp`) so it never ships to production.')
    }
  }
  catch {
    // no package.json worth warning about
  }

  const { content, used } = composeGuidelines(cwd)
  const agents = writeAgentsFile(cwd, content)
  info(`AGENTS.md ${agents} (sections: ${used.map(f => f.replace(/\.md$/, '')).join(', ')})`)

  const mcp = writeMcpConfig(cwd)
  info(`.mcp.json ${mcp} — MCP server "elyvel-mcp" registered`)

  comment('Re-run `elyvel mcp:install` after adding/removing @elyvel packages to refresh the guidelines.')
  comment('Restart your MCP client (or approve the new server) to pick up elyvel-mcp.')
  return 0
}

async function mcpServe(): Promise<number> {
  const cwd = process.cwd()
  if (!existsSync(join(cwd, 'config'))) {
    error('This does not look like an elyvel app (no config/ directory here).')
    return 1
  }

  // Over stdio, stdout carries ONLY protocol JSON. The framework logger's
  // console transport writes via console.log/info — one stray boot log line
  // on stdout corrupts the session, so redirect BEFORE the app boots.
  console.log = console.error.bind(console)
  console.info = console.error.bind(console)

  const app = await createApp({ basePath: cwd })
  const { serveMcp } = await import('./server')
  await serveMcp({ app, cwd })
  return 0
}

export const elyvelCommands: ConsoleCommand[] = [
  {
    name: 'mcp:install',
    description: 'Write AGENTS.md guidelines and register the elyvel-mcp MCP server in .mcp.json',
    run: mcpInstall,
  },
  {
    name: 'mcp:serve',
    description: 'Start the elyvel MCP server over stdio (spawned from .mcp.json, not by hand)',
    run: mcpServe,
  },
]
