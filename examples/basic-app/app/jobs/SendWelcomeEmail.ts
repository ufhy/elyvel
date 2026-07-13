import { Job } from '@elysia-ravel/queue'

/**
 * Example job: pretend to send a welcome email. Public fields are serialized to
 * the queue and restored on the worker, so keep them JSON-friendly.
 */
export class SendWelcomeEmail extends Job {
  /** Retry up to 3 times before `failed()` runs. */
  override tries = 3

  constructor(public email = '') {
    super()
  }

  async handle(): Promise<void> {
    // Real code would call a mailer here.
    console.log(`[job] sending welcome email to ${this.email}`)
  }

  override failed(error: unknown): void {
    console.error(`[job] giving up on welcome email to ${this.email}:`, error)
  }
}
