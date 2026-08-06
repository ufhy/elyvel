## Task scheduling (@elyvel/scheduler)

- Define schedules in the app's schedule file with `schedule()`; run them with
  `elyvel schedule:work` (long-running) or `schedule:run` (one tick, for an
  external cron). `schedule:list` shows what is registered and
  `schedule:test` runs one task now — use those instead of guessing.
- Cron expressions are parsed in the app timezone — check `partsInZone`
  semantics before assuming UTC.
- A scheduled task should be thin: dispatch a job or call a command, so the
  work is retryable and observable.
