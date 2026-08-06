## Events (@elyvel/events)

- Dispatch with `await event(new CommentPosted(comment))` or
  `await event('cache.cleared', payload)`; listeners register in the app's
  `EventServiceProvider`.
- An event is identified by its **class name string**, so two unrelated
  classes with the same simple name collide — registering the second one
  THROWS rather than firing the wrong listeners. Give one a pinned name.
- `event()` returns every listener's return value; `dispatcher().until(e)`
  stops at the first listener that answers.
- Listeners can be queued, and a plain event can be deferred until the
  surrounding transaction commits.
- Model events (created/updated/deleted) exist too — prefer an observer over
  scattering logic across call sites.
