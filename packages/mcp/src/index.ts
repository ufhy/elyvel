/**
 * @elyvel/mcp — AI-assisted development for elyvel apps: an MCP server
 * (application info, database schema + read-only queries, routes, logs,
 * tinker) plus composed agent guidelines. Install as a DEV dependency
 * (`bun add -d @elyvel/mcp`), run `elyvel mcp:install` once.
 *
 * This main entry stays featherweight on purpose: `elyvel package:discover`
 * imports it for every app, and nothing at runtime should ever need it. The
 * commands live behind `@elyvel/mcp/cli`; the MCP wiring behind those.
 */
export { type ComposedGuidelines, composeGuidelines } from './install/guidelines'
export { writeAgentsFile, writeMcpConfig } from './install/writers'
export type { McpContext, McpTool } from './tools'
