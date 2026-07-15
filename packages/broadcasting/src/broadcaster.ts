/** Pushes an event on one or more channels to subscribers. */
export interface Broadcaster {
  broadcast(
    channels: string[],
    event: string,
    payload: Record<string, unknown>,
  ): void | Promise<void>
}

/** Logs broadcasts instead of sending them (dev). */
export class LogBroadcaster implements Broadcaster {
  constructor(private readonly log: (line: string) => void = (l) => console.log(l)) {}
  broadcast(channels: string[], event: string, payload: Record<string, unknown>): void {
    this.log(`[broadcast] channels=${channels.join(',')} event=${event} ${JSON.stringify(payload)}`)
  }
}

/** Collects broadcasts in memory (tests). */
export class ArrayBroadcaster implements Broadcaster {
  readonly sent: { channels: string[]; event: string; payload: Record<string, unknown> }[] = []
  broadcast(channels: string[], event: string, payload: Record<string, unknown>): void {
    this.sent.push({ channels, event, payload })
  }
}
