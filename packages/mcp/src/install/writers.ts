/**
 * The two files `mcp:install` touches in an app, both idempotently:
 *
 * - `AGENTS.md` — the composed guidelines, held between markers so re-running
 *   the install refreshes ONLY our block and never a line the user wrote.
 * - `.mcp.json` — registers the `elyvel-mcp` MCP server (the standard file
 *   Claude Code, Cursor, and friends read), merged into whatever servers the
 *   file already lists.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const START_MARKER = '<!-- elyvel-mcp:guidelines:start — managed by `elyvel mcp:install`, edits inside are overwritten -->'
const END_MARKER = '<!-- elyvel-mcp:guidelines:end -->'

/**
 * Read a file, or `null` when it isn't there.
 *
 * Deliberately not `existsSync` then `readFileSync`: that is two decisions
 * about a file that can change between them, and the second one throws when it
 * loses the race. Ask once and handle the "not there" answer — the same shape
 * the log rotator uses.
 */
function readIfPresent(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  }
  catch (error) {
    if ((error as { code?: string }).code === 'ENOENT')
      return null
    throw error
  }
}

/** Write/refresh the guidelines block in AGENTS.md. Returns 'created' | 'updated' | 'appended'. */
export function writeAgentsFile(cwd: string, guidelines: string): 'created' | 'updated' | 'appended' {
  const path = join(cwd, 'AGENTS.md')
  const block = `${START_MARKER}\n\n${guidelines.trim()}\n\n${END_MARKER}`

  const existing = readIfPresent(path)
  if (existing === null) {
    writeFileSync(path, `${block}\n`)
    return 'created'
  }

  const start = existing.indexOf(START_MARKER)
  const end = existing.indexOf(END_MARKER)
  if (start !== -1 && end !== -1 && end > start) {
    const updated = existing.slice(0, start) + block + existing.slice(end + END_MARKER.length)
    writeFileSync(path, updated)
    return 'updated'
  }

  // The user has their own AGENTS.md — add our block after their content.
  writeFileSync(path, `${existing.trimEnd()}\n\n${block}\n`)
  return 'appended'
}

/**
 * The command MCP clients spawn. `bun node_modules/.bin/elyvel` rather than
 * `bunx elyvel`: the bare `elyvel` name on npm is NOT this framework's CLI,
 * and clients spawn from the project root where the local bin always exists.
 */
export const MCP_SERVER_ENTRY = {
  command: 'bun',
  args: ['node_modules/.bin/elyvel', 'mcp:serve'],
}

/** Register the server in .mcp.json, preserving other servers. Returns 'created' | 'updated' | 'unchanged'. */
export function writeMcpConfig(cwd: string): 'created' | 'updated' | 'unchanged' {
  const path = join(cwd, '.mcp.json')
  let config: { mcpServers?: Record<string, unknown> } = {}

  const raw = readIfPresent(path)
  const existed = raw !== null
  if (raw !== null) {
    try {
      config = JSON.parse(raw) as typeof config
    }
    catch {
      throw new Error(`.mcp.json exists but is not valid JSON — fix or remove it, then re-run mcp:install.`)
    }
  }

  const servers = config.mcpServers ?? {}
  const current = JSON.stringify(servers['elyvel-mcp'])
  if (current === JSON.stringify(MCP_SERVER_ENTRY))
    return 'unchanged'

  servers['elyvel-mcp'] = MCP_SERVER_ENTRY
  config.mcpServers = servers
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`)
  return existed ? 'updated' : 'created'
}
