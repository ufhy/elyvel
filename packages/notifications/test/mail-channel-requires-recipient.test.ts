import { Message } from '@elyvel/mail'
import { describe, expect, test } from 'bun:test'
import { MailChannel } from '../src/channels'

class InvoiceReady {
  via(): string[] {
    return ['mail']
  }

  toMail(): Message {
    // Deliberately sets no recipient — the notifiable is expected to supply it.
    return new Message().subject('Your invoice is ready')
  }
}

class InvoiceWithExplicitRecipient {
  via(): string[] {
    return ['mail']
  }

  toMail(): Message {
    return new Message().to('billing@example.test').subject('Your invoice is ready')
  }
}

/**
 * Regression: when `toMail()` set no recipient AND the notifiable had no
 * `routeNotificationFor('mail')`, the channel still called `deliver()`. The
 * log/array transports accept a zero-recipient message that real SMTP rejects,
 * so `notify()` resolved as delivered — and tests passed on a mail that would
 * never send in production.
 */
describe('the mail channel refuses a notification with nowhere to send it', () => {
  test('an unroutable notifiable raises instead of reporting success', async () => {
    const channel = new MailChannel()
    await expect(channel.send({ id: 1 } as any, new InvoiceReady() as any)).rejects.toThrow(
      /has no mail recipient/,
    )
  })

  test('a notifiable with an email attribute is routed normally', async () => {
    const channel = new MailChannel()
    // Resolves (delivery goes through the configured default mailer) rather than
    // throwing the unroutable error.
    await channel.send({ id: 1, email: 'user@example.test' } as any, new InvoiceReady() as any)
  })

  test('routeNotificationFor("mail") is honoured', async () => {
    const channel = new MailChannel()
    await channel.send(
      { id: 1, routeNotificationFor: (c: string) => (c === 'mail' ? 'routed@example.test' : undefined) } as any,
      new InvoiceReady() as any,
    )
  })

  test('a recipient set inside toMail() is enough on its own', async () => {
    const channel = new MailChannel()
    await channel.send({ id: 1 } as any, new InvoiceWithExplicitRecipient() as any)
  })
})
