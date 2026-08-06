import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { composeGuidelines } from '../src/install/guidelines'
import { MCP_SERVER_ENTRY, writeAgentsFile, writeMcpConfig } from '../src/install/writers'

const dirs: string[] = []

function tempApp(installed: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-install-'))
  dirs.push(dir)
  for (const name of installed) {
    const pkgDir = join(dir, 'node_modules', name)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version: '0.1.0-test' }))
  }
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('composeGuidelines', () => {
  test('always-on sections are present, package sections follow installation', () => {
    const { content, used } = composeGuidelines(tempApp(['@elyvel/core', '@elyvel/database']))
    expect(used).toContain('foundation.md')
    expect(used).toContain('mcp.md')
    expect(used).toContain('core.md')
    expect(used).toContain('database.md')
    expect(used).not.toContain('queue.md')
    expect(content).toContain('# elyvel Agent Guidelines')
    expect(content).toContain('## Database (@elyvel/database)')
    expect(content).not.toContain('## Queue')
  })

  test('the installed versions are stamped in', () => {
    const { content } = composeGuidelines(tempApp(['@elyvel/core']))
    expect(content).toContain('@elyvel/core@0.1.0-test')
  })
})

describe('writeAgentsFile', () => {
  test('creates AGENTS.md, then updates only its own block on re-run', () => {
    const dir = tempApp()
    expect(writeAgentsFile(dir, 'first version')).toBe('created')

    // User writes their own content around the block.
    const path = join(dir, 'AGENTS.md')
    writeFileSync(path, `# My own notes\n\n${readFileSync(path, 'utf8')}\nTrailing user text.\n`)

    expect(writeAgentsFile(dir, 'second version')).toBe('updated')
    const after = readFileSync(path, 'utf8')
    expect(after).toContain('# My own notes')
    expect(after).toContain('Trailing user text.')
    expect(after).toContain('second version')
    expect(after).not.toContain('first version')
  })

  test('appends to a pre-existing AGENTS.md without markers', () => {
    const dir = tempApp()
    writeFileSync(join(dir, 'AGENTS.md'), '# Handwritten\n')
    expect(writeAgentsFile(dir, 'guidelines')).toBe('appended')
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(content.startsWith('# Handwritten')).toBe(true)
    expect(content).toContain('guidelines')
  })
})

describe('writeMcpConfig', () => {
  test('creates .mcp.json, is idempotent, and preserves other servers', () => {
    const dir = tempApp()
    expect(writeMcpConfig(dir)).toBe('created')
    expect(writeMcpConfig(dir)).toBe('unchanged')

    const path = join(dir, '.mcp.json')
    const config = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(config.mcpServers['elyvel-mcp']).toEqual(MCP_SERVER_ENTRY)

    // Another server already registered must survive.
    config.mcpServers.other = { command: 'other-server' }
    delete config.mcpServers['elyvel-mcp']
    writeFileSync(path, JSON.stringify(config))
    expect(writeMcpConfig(dir)).toBe('updated')
    const merged = JSON.parse(readFileSync(path, 'utf8')) as { mcpServers: Record<string, unknown> }
    expect(merged.mcpServers.other).toEqual({ command: 'other-server' })
    expect(merged.mcpServers['elyvel-mcp']).toEqual(MCP_SERVER_ENTRY)
  })

  test('refuses to clobber an unparseable .mcp.json', () => {
    const dir = tempApp()
    writeFileSync(join(dir, '.mcp.json'), '{ not json')
    expect(() => writeMcpConfig(dir)).toThrow('not valid JSON')
    expect(readFileSync(join(dir, '.mcp.json'), 'utf8')).toBe('{ not json')
  })
})
