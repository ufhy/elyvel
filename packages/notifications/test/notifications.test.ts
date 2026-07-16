import type { ArrayTransport } from '@elysia-ravel/mail'
import type { Notifiable, StoredNotification } from '../src/index'
import { MailManager, Message, setDefaultMailer } from '@elysia-ravel/mail'
import { setDefaultTelegram, TelegramClient } from '@elysia-ravel/telegram'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { DatabaseChannel, MailChannel, TelegramChannel } from '../src/channels'
import {
  ArrayChannel,
  configureDatabaseNotifications,

  Notification,
  NotificationManager,

} from '../src/index'

// A notifiable user with per-channel routes.
const user: Notifiable = {
  id: 7,
  routeNotificationFor(channel) {
    if (channel === 'mail')
      return 'sam@example.com'
    if (channel === 'telegram')
      return 555
    return undefined
  },
}

// A multi-channel notification.
class InvoicePaid extends Notification {
  constructor(private readonly amount: number) {
    super()
  }

  via(): string[] {
    return ['array', 'mail', 'telegram', 'database']
  }

  override toArray() {
    return { amount: this.amount }
  }

  override toDatabase() {
    return { amount: this.amount, kind: 'invoice.paid' }
  }

  override toMail() {
    return new Message().subject('Invoice paid').html(`<p>Paid ${this.amount}</p>`)
  }

  override toTelegram() {
    return `Invoice paid: ${this.amount}`
  }
}

// live-ish backends: mail ArrayTransport + a local fake Telegram API
const telegramCalls: Record<string, unknown>[] = []
let tgServer: ReturnType<typeof Bun.serve>
beforeAll(() => {
  const mail = new MailManager({ default: 'array', mailers: { array: { transport: 'array' } } })
  setDefaultMailer(mail)
  tgServer = Bun.serve({
    port: 0,
    async fetch(req) {
      telegramCalls.push((await req.json()) as Record<string, unknown>)
      return Response.json({ ok: true, result: {} })
    },
  })
  setDefaultTelegram(
    new TelegramClient({ token: 'T', apiBase: `http://localhost:${tgServer.port}` }),
  )
})
afterAll(() => tgServer.stop(true))

describe('multi-channel dispatch', () => {
  test('via() routes to each registered channel', async () => {
    const stored: StoredNotification[] = []
    configureDatabaseNotifications({ insert: async r => void stored.push(r) })
    const mail = new MailManager({ default: 'array', mailers: { array: { transport: 'array' } } })
    setDefaultMailer(mail)

    const array = new ArrayChannel()
    const manager = new NotificationManager()
      .channel('array', array)
      .channel('mail', new MailChannel())
      .channel('telegram', new TelegramChannel())
      .channel('database', new DatabaseChannel())

    await manager.send(user, new InvoicePaid(99))

    // array
    expect(array.sent).toHaveLength(1)
    expect(array.sent[0]?.data).toEqual({ amount: 99 })
    // mail → routed to the user's email, captured by ArrayTransport
    const sentMail = (mail.transport('array') as ArrayTransport).sent
    expect(sentMail[0]?.toAddresses).toEqual(['sam@example.com'])
    expect(sentMail[0]?.subjectLine).toBe('Invoice paid')
    // telegram → routed to chat 555 via the local fake API
    expect(telegramCalls.at(-1)).toMatchObject({ chat_id: 555, text: 'Invoice paid: 99' })
    // database → stored with type + data + notifiable id
    expect(stored[0]).toMatchObject({
      type: 'InvoicePaid',
      notifiableId: 7,
      data: { kind: 'invoice.paid' },
    })
    expect(stored[0]?.readAt).toBeNull()
  })

  test('only the channels in via() fire', async () => {
    class OnlyArray extends Notification {
      via() {
        return ['array']
      }

      override toArray() {
        return { x: 1 }
      }
    }
    const array = new ArrayChannel()
    const manager = new NotificationManager()
      .channel('array', array)
      .channel('mail', new MailChannel())
    await manager.send(user, new OnlyArray())
    expect(array.sent).toHaveLength(1)
  })
})
