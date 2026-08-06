/**
 * @elyvel/boost — AI-assisted development for elyvel apps: an MCP server
 * (application info, database schema + read-only queries, routes, logs,
 * tinker) plus composed agent guidelines. Install as a DEV dependency
 * (`bun add -d @elyvel/boost`), run `elyvel boost:install` once.
 *
 * This main entry stays featherweight on purpose: `elyvel package:discover`
 * imports it for every app, and nothing at runtime should ever need it. The
 * commands live behind `@elyvel/boost/cli`; the MCP wiring behind those.
 */
export { type ComposedGuidelines, composeGuidelines } from './install/guidelines'
export { writeAgentsFile, writeMcpConfig } from './install/writers'
export type { BoostContext, BoostTool } from './mcp/tools'
