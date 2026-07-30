#!/usr/bin/env bun
import { newApp, parseArgs } from '@elyvel/cli'

/**
 * `bun create @elyvel <name> [--kit=vue|spa|none]`.
 *
 * The npm/bun scoped-initializer convention: `bun create @elyvel` resolves to
 * `@elyvel/create` and runs this bin (verified on both bun and npm).
 * It's a thin launcher — the actual scaffolding (and bundled templates) live in
 * `@elyvel/cli`'s `newApp`, so `bun create @elyvel` and `elyvel new` stay in sync.
 */
const { positionals, flags } = parseArgs(process.argv.slice(2))
process.exit(await newApp(positionals[0] ?? '', flags))
