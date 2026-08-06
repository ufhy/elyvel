## Broadcasting (@elyvel/broadcasting)

- `broadcast(new OrderShipped(order))` sends to the channels the event's
  `broadcastOn()` returns; channels are declared with `channel(name, authorizer)`.
- **Private channels need an authorizer**: `channel(pattern, (identity,
  params) => boolean | Promise<boolean>)`. Return a real boolean — a missing
  return is not "allowed".
- The WebSocket layer can run in-process or as its own process
  (`elyvel broadcast:serve`).
