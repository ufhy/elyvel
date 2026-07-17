import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { bringDown, bringUp, isDownForMaintenance } from '@elysia-ravel/core'

function downFile(): string {
  return join(process.cwd(), 'storage/framework/down')
}

/**
 * `ravel down [--secret=…] [--retry=秒] [--message=…] [--status=503]`
 * Put the app into maintenance mode. Without an explicit `--secret`, a random
 * one is generated and printed — visit `/?secret=…` to bypass the 503.
 */
export function down(flags: Record<string, string | boolean> = {}): number {
  const secret = typeof flags.secret === 'string'
    ? flags.secret
    : flags.secret === true
      ? randomBytes(16).toString('hex')
      : undefined
  const retryAfter = typeof flags.retry === 'string' ? Number(flags.retry) : undefined
  const message = typeof flags.message === 'string' ? flags.message : undefined
  const status = typeof flags.status === 'string' ? Number(flags.status) : undefined

  bringDown(downFile(), { secret, retryAfter, message, status })
  console.log('✓ Application is now in maintenance mode.')
  if (secret)
    console.log(`  Bypass: visit /?secret=${secret}`)
  return 0
}

/** `ravel up` — bring the app out of maintenance mode. */
export function up(): number {
  if (!isDownForMaintenance(downFile())) {
    console.log('  Application is already up.')
    return 0
  }
  bringUp(downFile())
  console.log('✓ Application is now live.')
  return 0
}
