import type { ArrayTransport } from '@elyvel/mail'
import type { Channel } from '../src/channels'
import type { Notifiable, StoredNotification } from '../src/index'
import { MailManager, Message, setDefaultMailer } from '@elyvel/mail'
import { setDefaultTelegram, TelegramClient } from '@elyvel/telegram'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { DatabaseChannel, MailChannel, TelegramChannel } from '../src/channels'
import {
  ArrayChannel,
  configureDatabaseNotifications,
  configureFailedNotifications,
  MemoryFailedNotificationStore,
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

describe('one channel failing does not drop the others', () => {
  class MultiChannel extends Notification {
    via() {
      return ['broken', 'array']
    }

    override toArray() {
      return { ok: true }
    }
  }

  test('the working channel still fires, and the failure is recorded + rethrown', async () => {
    const store = new MemoryFailedNotificationStore()
    configureFailedNotifications(store)

    const array = new ArrayChannel()
    const broken: Channel = {
      send: async () => {
        throw new Error('webhook unreachable')
      },
    }
    const manager = new NotificationManager()
      .channel('broken', broken)
      .channel('array', array)

    await expect(manager.send(user, new MultiChannel())).rejects.toThrow('webhook unreachable')

    // The channel after the failing one still ran — it used to be silently skipped.
    expect(array.sent).toHaveLength(1)

    const records = await store.all()
    expect(records).toHaveLength(1)
    expect(records[0]?.channel).toBe('broken')
    expect(records[0]?.exception).toContain('webhook unreachable')
    expect(records[0]?.notifiableId).toBe('7')
  })

  test('sendMany: one notifiable failing does not stop the others', async () => {
    const store = new MemoryFailedNotificationStore()
    configureFailedNotifications(store)

    const array = new ArrayChannel()
    const broken: Channel = {
      send: async (notifiable) => {
        if (notifiable.id === 'bad')
          throw new Error('nope')
      },
    }
    const manager = new NotificationManager().channel('broken', broken).channel('array', array)

    const notifiables: Notifiable[] = [{ id: 'bad' }, { id: 'good' }]
    await expect(manager.sendMany(notifiables, new MultiChannel())).rejects.toThrow()

    // Both notifiables were attempted on the 'array' channel despite the first's failure.
    expect(array.sent).toHaveLength(2)
  })
})
