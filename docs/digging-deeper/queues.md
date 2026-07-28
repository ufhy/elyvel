# Queues

Move slow or unreliable work — sending an email, calling a third-party API,
processing an upload — off the request/response cycle. A job is dispatched
instantly; a separate worker process picks it up and runs it.

## Configuration

```ts
// config/queue.ts
import { defineQueueConfig } from '@elyvel/queue'

export default defineQueueConfig({
  default: process.env.QUEUE_CONNECTION ?? 'sync',
  connections: {
    sync: { driver: 'sync' },         // runs inline, no worker — good for local dev
    database: { driver: 'database' }, // needs a `jobs` table (EloquentServiceProvider wires it)
    redis: { driver: 'redis', url: process.env.REDIS_URL, queue: 'queues' },
  },
})
```

Four drivers: `sync` (no queue at all — runs immediately in-process),
`memory` (a real in-process queue, useful for tests), `database`, and
`redis`. `sync` can't be worked by `queue:work` — there's nothing to poll.

## Creating jobs

A job is a plain class extending `Job` with a `handle()` method. Public
constructor fields become the job's serialized payload:

```ts
// app/jobs/SendWelcomeEmail.ts
import { Job } from '@elyvel/queue'

export class SendWelcomeEmail extends Job {
  constructor(public userId: number) {
    super()
  }

  async handle(): Promise<void> {
    const user = await User.findOrFail(this.userId)
    await Mail.to(user.email).send(new WelcomeMail(user))
  }

  async failed(error: unknown): Promise<void> {
    // called once retries are exhausted
  }
}
```

Register every job class once at boot so the worker can reconstruct
instances from their serialized payload by class name:

```ts
// app/jobs/index.ts (imported by config/app.ts or a service provider)
import { registerJob } from '@elyvel/queue'
import { SendWelcomeEmail } from './SendWelcomeEmail'

registerJob(SendWelcomeEmail /* , ...other job classes */)
```

Retry/behavior fields on a job: `tries` (default 1), `backoff` (seconds, or
an array for increasing delays per attempt), `timeout`, `maxExceptions`.

## Dispatching jobs

```ts
import { dispatch, dispatchSync } from '@elyvel/queue'

await dispatch(new SendWelcomeEmail(user.id))

// Options: delay (seconds), a named connection, a named queue lane
await dispatch(new SendWelcomeEmail(user.id), {
  delay: 60,
  connection: 'redis',
  queue: 'emails',
})

// Run immediately, bypassing the queue entirely (e.g. in a test)
await dispatchSync(new SendWelcomeEmail(user.id))
```

A plain function can be dispatched too, without a `Job` subclass — the
closure is serialized (it must be self-contained, no captured variables from
outside):

```ts
await dispatch(() => console.log('ran on the worker'))
```

### Job chaining

Chain jobs so the next one only runs after the previous succeeds:

```ts
const job = new ProcessUpload(fileId)
job.chain([new GenerateThumbnails(fileId), new NotifyOwner(fileId)])
await dispatch(job)
```

### Dispatching after a database transaction commits

Pass `afterCommit: true` (needs `configureAfterCommit` wired at boot) to
defer dispatch until the enclosing transaction actually commits — avoids a
worker picking up a job that references a row the transaction then rolls
back.

## Job middleware

A job can declare middleware via `middleware(): JobMiddleware[]`, run around
`handle()`:

```ts
import { Job, RateLimited, WithoutOverlapping } from '@elyvel/queue'

export class GenerateReport extends Job {
  constructor(public teamId: number) { super() }

  middleware() {
    return [
      new WithoutOverlapping(`report:${this.teamId}`, { releaseAfter: 60 }),
      new RateLimited(`reports`, { maxAttempts: 10, perSeconds: 60 }),
    ]
  }

  async handle(): Promise<void> { /* ... */ }
}
```

`WithoutOverlapping` prevents a second job with the same key from running
concurrently — a contending job is released back onto the queue instead of
running. `RateLimited` throttles how often jobs with the same key may run.
Both need a store configured once at boot (`configureUniqueJobs`,
`configureRateLimiter`) — in-memory (per-process) or Redis-backed (shared
across workers) implementations ship out of the box.

### Unique jobs

A separate, simpler mechanism for "don't enqueue this again if one's already
pending" — set `unique = true` (optionally override `uniqueId()` for a
custom dedupe key, and `uniqueFor` for how long the lock holds, default
3600s):

```ts
export class SyncInventory extends Job {
  static override unique = true
  uniqueId() { return 'inventory-sync' }
}
```

Dispatching a duplicate while the lock holds is silently dropped; the lock
releases when the job finishes (success or final failure).

## Job batching

Dispatch a group of jobs together and track overall progress:

```ts
import { Bus, findBatch } from '@elyvel/queue'

const batch = await Bus.batch([
  new ImportRow(1),
  new ImportRow(2),
  new ImportRow(3),
])
  .name('csv-import')
  .onQueue('imports')
  .then(batch => console.log('all done'))
  .catch((batch, error) => console.log('a job failed', error))
  .finally(batch => console.log('batch settled'))
  .dispatch()

batch.total      // 3
batch.progress() // 0–100

// Later, from anywhere:
const current = await findBatch(batch.id)
current.processed // total - pending
current.finished  // boolean
```

`.allowFailures()` lets remaining jobs keep running after one fails (default:
a failure cancels the rest of the batch and skips straight to `.catch()`).
Callbacks are serialized like queued closures — keep them self-contained.
Needs `configureBatches(...)` wired at boot (memory or Redis-backed).

## Running the queue worker

```bash
elyvel queue:work                          # process the default connection/queue forever
elyvel queue:work --queue=high,default      # poll queues in priority order
elyvel queue:work --once                    # process exactly one job, then exit
elyvel queue:work --stop-when-empty         # exit once the queue is drained
elyvel queue:work --sleep=3 --max=100       # poll interval, and a job-count limit
```

Run this as its own long-lived process (separate from the web server) in
production — the `database`/`redis` drivers are what let it do so. `sync`
can't be worked (there's no queue to poll).

Gracefully restart every running worker after a deploy — `queue:restart`
signals workers to exit after finishing their current job, rather than
killing them mid-job:

```bash
elyvel queue:restart
```

## Handling failed jobs

When a job exhausts its `tries`, it's recorded (connection, queue, the exact
serialized payload, and the error) instead of silently vanishing:

```bash
elyvel queue:failed                # list failed jobs
elyvel queue:retry <id>            # re-push one back onto its original queue
elyvel queue:retry --all           # retry everything
elyvel queue:forget <id>           # delete one failed record
elyvel queue:flush                 # delete all failed records
elyvel queue:prune-failed --hours=24
```

## Job events

Process-wide hooks, useful for logging/metrics without touching every job:

```ts
import { Queue } from '@elyvel/queue'

Queue.before(name => console.log(`starting ${name}`))
Queue.after(name => console.log(`finished ${name}`))
Queue.failing((name, error) => console.log(`${name} failed`, error))
```

If `@elyvel/events` is installed, these also fire as regular events
(`queue.processing`, `queue.processed`, `queue.failed`) — `listen('queue.failed', ...)`
works without `@elyvel/queue` depending on the events package directly.

## Queueing event listeners

A listener that should run on the queue instead of inline needs no extra
job-writing — implement the listener as usual and register it with
`registerListener(...)` (alongside `registerJob`) instead of the framework
running it synchronously.

## Model serialization

A job field holding an Eloquent model instance isn't serialized as a raw
snapshot — it's dehydrated to a lightweight `{ model, id }` reference before
being written to the queue, and re-fetched fresh from the database right
before `handle()` runs. This means a job dispatched with a model attached
always sees that model's *current* state on the worker, not a stale copy
from the moment it was queued.
