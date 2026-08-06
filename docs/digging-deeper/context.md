# Context

Request-scoped values that ride the entire async continuation, land on every log
entry written during it, and travel with queued jobs — Laravel's `Context`.

The problem it solves is correlation. A request logs in six places across four
modules; without shared context, every call site must be handed the trace id
explicitly — and the one that wasn't is always the one you needed.

```ts
// In a middleware:
Context.add('trace_id', crypto.randomUUID())
Context.add('url', request.url)

// Anywhere downstream — another module, a queued job's handle():
log.info('payment charged')
// ⇒ {"message":"payment charged","trace_id":"…","url":"…"}
```

## Capturing

```ts
Context.add('key', 'value')
Context.add({ several: 1, at: 'once' })
Context.addIf('key', 'only when unset')
Context.push('breadcrumbs', 'auth', 'billing') // appends to an array
Context.increment('records_imported', 5)
```

Reading: `get`, `has`, `only(['a', 'b'])`, `all`, `forget`.

A scope is opened per request automatically (same `AsyncLocalStorage` mechanism
as the actor/userstamps scope). Two concurrent requests never see each other's
context. Outside a scope — a bare script — reads return `undefined` and writes
are no-ops rather than crashes; open one yourself with `withContextScope(fn)`.

## Logs

Every entry written inside the scope carries the visible context. Precedence on
a key collision: the call site wins over the logger's bindings, which win over
context — the more specific always wins.

## Queued jobs

Context is captured when a job is dispatched and restored around its `handle()`
— so the `trace_id` set by middleware is on the log lines a worker writes,
minutes later, in another process:

```ts
// request:                              // worker, elsewhere:
Context.add('trace_id', id)
await dispatch(new SyncInventory(sku))   // handle() logs carry trace_id=id
```

## Hidden context

Travels with the context (including into jobs) but never reaches a log entry —
for what a trace needs and a log file must not hold:

```ts
Context.addHidden('api_token', token)
Context.getHidden('api_token')
```
