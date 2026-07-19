import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { createApp, FileMaintenanceStore, maintenanceStore } from '@elyvel/core'

function downFile(): string {
  return join(process.cwd(), 'storage/framework/down')
}

/**
 * Boots the app (so a `configureMaintenanceStore(...)` call in a
 * ServiceProvider takes effect for this one-shot CLI process too — the same
 * reason `queue:work`/`queue:restart` boot the app before touching their own
 * cross-process state) and returns the active store: whatever the app
 * configured, or the local-file default.
 */
async function resolveStore() {
  await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  return maintenanceStore() ?? new FileMaintenanceStore(downFile())
}

/**
 * `elyvel down [--secret=…] [--retry=秒] [--message=…] [--status=503]`
 * Put the app into maintenance mode. Without an explicit `--secret`, a random
 * one is generated and printed — visit `/?secret=…` to bypass the 503.
 */
export async function down(flags: Record<string, string | boolean> = {}): Promise<number> {
  const secret = typeof flags.secret === 'string'
    ? flags.secret
    : flags.secret === true
      ? randomBytes(16).toString('hex')
      : undefined
  const retryAfter = typeof flags.retry === 'string' ? Number(flags.retry) : undefined
  const message = typeof flags.message === 'string' ? flags.message : undefined
  const status = typeof flags.status === 'string' ? Number(flags.status) : undefined

  await (await resolveStore()).write({ secret, retryAfter, message, status })
  console.log('✓ Application is now in maintenance mode.')
  if (secret)
    console.log(`  Bypass: visit /?secret=${secret}`)
  return 0
}

/** `elyvel up` — bring the app out of maintenance mode. */
export async function up(): Promise<number> {
  const store = await resolveStore()
  if (!(await store.read())) {
    console.log('  Application is already up.')
    return 0
  }
  await store.clear()
  console.log('✓ Application is now live.')
  return 0
}
