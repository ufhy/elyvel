/**
 * Graceful worker restart (Laravel's `queue:restart`). A worker records when it
 * started; `queue:restart` writes a newer timestamp; workers that started
 * before it finish their current job then exit (a supervisor restarts them).
 * Needs a shared store (cache/db) via {@link configureRestartSignal}; without
 * one, `queue:restart` reports that it's unavailable.
 */
export interface RestartSignal {
  /** The epoch ms of the last restart request, or null if none. */
  requestedAt(): Promise<number | null>
  /** Record a restart request now. */
  request(): Promise<void>
}

let signal: RestartSignal | null = null
export function configureRestartSignal(store: RestartSignal): void {
  signal = store
}
export function restartSignal(): RestartSignal | null {
  return signal
}
