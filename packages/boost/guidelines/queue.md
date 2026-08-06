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
