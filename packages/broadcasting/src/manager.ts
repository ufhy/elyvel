import type { Broadcaster } from './broadcaster'

let defaultBroadcaster: Broadcaster | null = null

export function setDefaultBroadcaster(broadcaster: Broadcaster): void {
  defaultBroadcaster = broadcaster
}

export function broadcaster(): Broadcaster {
  if (!defaultBroadcaster) {
    throw new Error(
      '[elyvel] Broadcasting is not configured. Register BroadcastServiceProvider.',
    )
  }
  return defaultBroadcaster
}
