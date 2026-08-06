## Queue (@elyvel/queue)

- Jobs are classes in `app/jobs/` (`elyvel make:job <Name>`); dispatch with
  `dispatch(new SendWelcomeEmail(user))`, run workers with
  `elyvel queue:work`.
- The `sync` connection runs jobs inline (the default in development) — a job
  "not running" usually means the configured connection has no worker.
- Request `Context` values dehydrate into the job and rehydrate in the worker;
  don't pass them by hand.
- In tests, use the queue fake and its `assertPushed` family instead of
  running a worker.
- `dispatch(() => …)` queues a CLOSURE, whose source is signed with `app.key`
  and verified on the worker. It therefore needs `APP_KEY` set, and the
  closure must be self-contained — nothing captured from the enclosing scope
  survives. When in doubt prefer a Job class: it carries data, not code.
