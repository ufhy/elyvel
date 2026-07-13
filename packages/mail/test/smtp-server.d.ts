// Minimal ambient types for smtp-server (no @types package published).
declare module 'smtp-server' {
  import type { Readable } from 'node:stream'
  export class SMTPServer {
    constructor(options: {
      authOptional?: boolean
      disabledCommands?: string[]
      onData?: (stream: Readable, session: unknown, callback: (err?: Error) => void) => void
    })
    listen(port: number, callback?: () => void): void
    close(callback?: () => void): void
  }
}
