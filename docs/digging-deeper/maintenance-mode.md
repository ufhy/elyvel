# Maintenance Mode

Take the app offline with a `503` for everyone except a bypass secret you
control — deploy migrations without half-served requests hitting a
half-migrated schema.

## Basic usage

```bash
elyvel down
elyvel down --secret=my-bypass-token --retry=60 --message="Upgrading the database"
elyvel up
```

Bare `--secret` (no value) generates and prints a random one for you.
Visit `/?secret=<token>` in a browser to set a bypass cookie for that
browser — every other visitor keeps seeing the maintenance page until
`elyvel up`. `--retry` sets the `Retry-After` header (seconds); `--status`
overrides the response code (default `503`).

See [CLI Reference](/guide/cli-reference) for every flag.

## How it's enforced

`maintenanceMode(file)` is a global plugin mounted before every route; it
reads the down-state fresh on **every request** (not just once at boot),
so a state change during the app's lifetime (another process running
`elyvel down`, or a later `configureMaintenanceStore` call) takes effect
immediately without a restart. A request gets JSON or HTML depending on
content negotiation, matching the rest of the framework's error handling.

## Multi-instance deployments

By default, maintenance state is a file on local disk — `elyvel down` run
against one instance only takes that instance down; a load balancer keeps
routing to the others, and the app silently stays "up" for most visitors
during the outage window. Back it with a shared store instead:

```ts
import { configureMaintenanceStore, RedisMaintenanceStore } from '@elyvel/core'

configureMaintenanceStore(new RedisMaintenanceStore(redisClient))
```

Every instance sharing that Redis now sees the same down/up state — the
whole app actually goes down, not just the instance the CLI happened to
run on.

## Programmatic API

```ts
import { bringDown, bringUp, isDownForMaintenance, readDownPayload } from '@elyvel/core'

bringDown(downFilePath, { message: 'Scheduled maintenance', retryAfter: 120 })
isDownForMaintenance(downFilePath) // boolean
readDownPayload(downFilePath) // DownPayload | null
bringUp(downFilePath)
```

These are the low-level file operations the CLI commands themselves call
— useful if you want to trigger maintenance mode from your own script or
deploy hook instead of shelling out to `elyvel down`.

`resetMaintenanceStore()` clears a configured store back to the file
fallback — mainly for tests.
