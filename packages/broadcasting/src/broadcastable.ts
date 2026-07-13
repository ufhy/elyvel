import { broadcaster } from './manager'

/**
 * A broadcastable event (Laravel's `ShouldBroadcast`). Set the channels in
 * `broadcastOn()`; optionally customize the event name and payload.
 */
export abstract class Broadcastable {
  abstract broadcastOn(): string[]
  broadcastAs(): string {
    return this.constructor.name
  }
  broadcastWith(): Record<string, unknown> {
    const { ...data } = this as unknown as Record<string, unknown>
    return data
  }
}

/** Broadcast an event to its channels via the default broadcaster. */
export function broadcast(event: Broadcastable): void | Promise<void> {
  return broadcaster().broadcast(event.broadcastOn(), event.broadcastAs(), event.broadcastWith())
}
