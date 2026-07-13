import { Mail } from '@elysia-ravel/mail'
import { Job } from '@elysia-ravel/queue'

/**
 * Example job: send a welcome email off the queue (the realistic pattern —
 * dispatch a job, the worker sends the mail). Public fields are serialized to
 * the queue and restored on the worker, so keep them JSON-friendly.
 */
export class SendWelcomeEmail extends Job {
  /** Retry up to 3 times before `failed()` runs. */
  override tries = 3

  constructor(public email = '') {
    super()
  }

  async handle(): Promise<void> {
    await Mail.to(this.email)
      .subject('Welcome to Basic App!')
      .html('<h1>Welcome 👋</h1><p>Thanks for signing up.</p>')
      .send()
  }

  override failed(error: unknown): void {
    console.error(`[job] giving up on welcome email to ${this.email}:`, error)
  }
}
