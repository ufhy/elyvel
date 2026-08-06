/**
 * The only file that speaks MCP — everything the tools DO lives in
 * `tools.ts`, testable without a client. This wires them onto the official
 * `@modelcontextprotocol/server` SDK over stdio.
 */
import type { BoostContext } from './tools'
import { McpServer } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { boostTools } from './tools'

const SERVER_INSTRUCTIONS
  = 'elyvel MCP server: live application info, database schema and read-only queries, routes, logs and last error, and a tinker evaluator. Prefer these tools over shell commands or guessing — they read the running application, not your assumptions.'

export function createBoostServer(ctx: BoostContext): McpServer {
  const server = new McpServer(
    { name: 'elyvel-boost', version: '1.0.0' },
    { instructions: SERVER_INSTRUCTIONS },
  )

  for (const tool of boostTools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: tool.readOnly },
      },
      async (args: Record<string, unknown>) => ({
        content: [{ type: 'text' as const, text: await tool.handle(args ?? {}, ctx) }],
      }),
    )
  }

  return server
}

/**
 * Serve over stdio and resolve when the client hangs up. stdout belongs to
 * the protocol from here on — the caller must have redirected all logging to
 * stderr BEFORE booting the app.
 */
export async function serveBoost(ctx: BoostContext): Promise<void> {
  const server = createBoostServer(ctx)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  await new Promise<void>((resolve) => {
    process.stdin.once('end', resolve)
    process.stdin.once('close', resolve)
  })
}
