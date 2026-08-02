import type { Notifiable } from '../src/notification'
import { describe, expect, test } from 'bun:test'
import { NotificationManager } from '../src/manager'
import { Notification } from '../src/notification'

/** A channel from an imaginary third-party package — never registered anywhere. */
const delivered: string[] = []
let constructed = 0

class WhatsAppChannel {
  constructor() {
    constructed++
  }

  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    delivered.push(`${(notifiable as { phone?: string }).phone}:${notification.constructor.name}`)
  }
}

class OrderShipped extends Notification {
  override via(): (string | typeof WhatsAppChannel)[] {
    return [WhatsAppChannel]
  }
}

/**
 * Laravel's ChannelManager falls back to `class_exists($driver)` and resolves the
 * class from the container, which is the whole reason `laravel-notification-
 * channels/*` can exist without Laravel knowing about any of them. Ours only
 * accepted registered strings, so a contributor's channel meant editing the
 * notifications package — adding a peer dependency and two lines to a provider.
 */
describe('via() accepts a channel class', () => {
  test('an unregistered class is instantiated and used', async () => {
    delivered.length = 0
    const manager = new NotificationManager()

    await manager.send({ phone: '+62' } as Notifiable, new OrderShipped())

    expect(delivered).toEqual(['+62:OrderShipped'])
  })

  test('the instance is cached — a channel holding a connection is built once', async () => {
    constructed = 0
    const manager = new NotificationManager()

    await manager.send({ phone: '+1' } as Notifiable, new OrderShipped())
    await manager.send({ phone: '+2' } as Notifiable, new OrderShipped())

    expect(constructed).toBe(1)
  })

  test('strings and classes mix in one via()', async () => {
    delivered.length = 0
    const seen: string[] = []
    const manager = new NotificationManager().channel('array', {
      send: async () => void seen.push('array'),
    })

    class Mixed extends Notification {
      override via(): (string | typeof WhatsAppChannel)[] {
        return ['array', WhatsAppChannel]
      }
    }

    await manager.send({ phone: '+3' } as Notifiable, new Mixed())

    expect(seen).toEqual(['array'])
    expect(delivered).toEqual(['+3:Mixed'])
  })
})
