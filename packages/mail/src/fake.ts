import type { Mailable } from './mailable'
import type { Message } from './message'
import { MailManager, mailManager, setDefaultMailer } from './manager'

type MailableClass = new (...args: never[]) => Mailable
type MessagePredicate = (message: Message) => boolean

/**
 * A MailManager that records instead of sending — Laravel's `Mail::fake()`.
 *
 * The `array` transport already existed, but it records at the wrong layer for a
 * test: it needs the transport swapped in config, it captures per-mailer rather
 * than globally, and it offers no assertions — a test had to dig through an array
 * and hand-write the failure message. A fake replaces the manager itself, so
 * every path in (`Mail.to()`, `mail().compose()`, a Mailable) is captured, and
 * failures explain themselves.
 */
export class MailFake extends MailManager {
  readonly sentMessages: Message[] = []

  /** Records the message; nothing leaves the process. */
  override async deliver(message: Message, _transportName?: string): Promise<void> {
    this.sentMessages.push(message)
  }

  /** Messages matching a Mailable class, a predicate, or everything. */
  sent(match?: MailableClass | MessagePredicate): Message[] {
    if (!match)
      return [...this.sentMessages]
    if (isMailableClass(match))
      return this.sentMessages.filter(m => m.mailable instanceof match)
    return this.sentMessages.filter(m => match(m))
  }

  /**
   * Assert at least one matching message was sent. Pass a Mailable class, a
   * predicate over the built Message, or both.
   */
  assertSent(match: MailableClass | MessagePredicate, callback?: MessagePredicate): void {
    let hits = this.sent(match)
    if (callback)
      hits = hits.filter(m => callback(m))
    if (hits.length === 0) {
      throw new Error(
        `Expected ${describe(match)} to have been sent, but it was not. `
        + `${this.sentMessages.length} message(s) were sent${this.summarise()}`,
      )
    }
  }

  /** Assert an exact number of matching messages. */
  assertSentTimes(match: MailableClass | MessagePredicate, times: number): void {
    const count = this.sent(match).length
    if (count !== times) {
      throw new Error(
        `Expected ${describe(match)} to have been sent ${times} time(s), but it was sent ${count} time(s).`,
      )
    }
  }

  /** Assert no matching message was sent. */
  assertNotSent(match: MailableClass | MessagePredicate): void {
    if (this.sent(match).length > 0)
      throw new Error(`Expected ${describe(match)} NOT to have been sent, but it was.`)
  }

  /** Assert something was sent to this address, on to/cc/bcc. */
  assertSentTo(email: string): void {
    const hit = this.sentMessages.some(m =>
      [...m.toAddresses, ...m.ccAddresses, ...m.bccAddresses].some(a => addressEmail(a) === email),
    )
    if (!hit) {
      throw new Error(
        `Expected a message to ${email}, but none was sent to that address${this.summarise()}`,
      )
    }
  }

  /** Assert the fake saw nothing at all. */
  assertNothingSent(): void {
    if (this.sentMessages.length > 0) {
      throw new Error(
        `Expected no mail to have been sent, but ${this.sentMessages.length} message(s) were${this.summarise()}`,
      )
    }
  }

  assertSentCount(count: number): void {
    if (this.sentMessages.length !== count) {
      throw new Error(
        `Expected ${count} message(s) to have been sent, but ${this.sentMessages.length} were.`,
      )
    }
  }

  /** ` (sent: "subject" to a@b; …)` — so a failed assertion names what DID happen. */
  private summarise(): string {
    if (this.sentMessages.length === 0)
      return '.'
    const lines = this.sentMessages.slice(0, 5).map((m) => {
      const to = m.toAddresses.map(addressEmail).join(', ') || '(no recipient)'
      return `"${m.subjectLine || '(no subject)'}" to ${to}`
    })
    return `: ${lines.join('; ')}${this.sentMessages.length > 5 ? '; …' : ''}.`
  }
}

function isMailableClass(value: MailableClass | MessagePredicate): value is MailableClass {
  // A class's prototype carries `build`; a bare predicate's does not.
  return typeof value === 'function' && typeof (value as MailableClass).prototype?.build === 'function'
}

function addressEmail(address: string | { email: string }): string {
  return typeof address === 'string' ? address : address.email
}

function describe(match: MailableClass | MessagePredicate): string {
  return isMailableClass(match) ? `[${match.name}]` : 'a matching message'
}

/**
 * Swap the default mailer for a recording fake; returns it for assertions.
 * Restore the real one with {@link restoreMail} (or just let the test process
 * end — the fake is process-wide state like every default manager here).
 *
 * ```ts
 * const mail = fakeMail()
 * await registerUser('ada@example.com')
 * mail.assertSent(WelcomeMail, m => m.toAddresses.some(a => a.email === 'ada@example.com'))
 * ```
 */
export function fakeMail(): MailFake {
  const fake = new MailFake()
  setDefaultMailer(fake)
  return fake
}

/** Restore a previously-captured real manager (e.g. `const real = mailManager()`). */
export function restoreMail(manager: MailManager): void {
  setDefaultMailer(manager)
}

/** The real manager, captured before faking so it can be restored. */
export function currentMailManager(): MailManager {
  return mailManager()
}
