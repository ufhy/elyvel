import { createApp } from '@elyvel/core'

/**
 * `elyvel broadcast:serve [--port=<n>]` — run just the broadcast/WebSocket
 * layer as its own long-running process, separate from the instance(s)
 * serving HTTP traffic (the same idea as `queue:work` being its own process
 * for background jobs). Boots the app's normal config/providers (so
 * `BroadcastServiceProvider` picks up `config/broadcasting.ts` exactly like
 * `elyvel serve` would) but skips route autoloading — this process's only
 * job is upgrading WebSocket connections and, with the `redis` driver,
 * relaying broadcasts to every other instance's own hub.
 *
 * Requires `BroadcastServiceProvider` in `config/app.ts`'s `providers`.
 */
export async function broadcastServeCommand(flags: Record<string, string | boolean>): Promise<number> {
  const app = await createApp({ basePath: process.cwd(), autoloadRoutes: false })
  const port = flags.port ? Number(flags.port) : undefined
  await app.listen(port)
  console.log('Broadcast server up — WebSocket connections only, no HTTP routes served.')

  // `app.listen()` resolves as soon as Bun.serve is up (there's no internal
  // work loop like queue:work's `while (true)`), so without this the CLI's
  // `process.exit(await main())` would tear the server down the instant this
  // function returns. Block until an operator asks it to stop.
  await new Promise<void>((resolve) => {
    process.once('SIGINT', () => resolve())
    process.once('SIGTERM', () => resolve())
  })
  return 0
}
