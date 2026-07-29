import type { Channel } from '../src/channels'
import type { Notifiable } from '../src/notification'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  NotificationManager,
  notifications,
  notify,
  setDefaultNotifications,
} from '../src/manager'
import { Notification } from '../src/notification'

/**
 * Covers NotificationManager.send/sendMany, the default-manager singleton, and
 * the notify() helper (single + array) — only channel routing was tested.
 */

class Ping extends Notification {
  via(): string[] {
    return ['array']
  }
}

/** Names a channel nobody registered — must be reported, not skipped. */
class PingWithUnknownChannel extends Notification {
  via(): string[] {
    return ['array', 'unregistered']
  }
}

function capturingChannel(): { channel: Channel, got: Notifiable[] } {
  const got: Notifiable[] = []
  return {
    got,
    channel: { async send(notifiable) { got.push(notifiable) } },
  }
}

afterEach(() => setDefaultNotifications(new NotificationManager()))

describe('NotificationManager', () => {
  test('send routes to every registered channel named by via()', async () => {
    const { channel, got } = capturingChannel()
    const manager = new NotificationManager().channel('array', channel)
    const user: Notifiable = { id: 1 }
    await manager.send(user, new Ping())
    expect(got).toEqual([user])
  })

  /**
   * Regression: an unregistered channel name used to `continue`, so `send()`
   * resolved having delivered nothing through it. `toBroadcast()` exists on
   * Notification but the default provider registers only array/mail/telegram/
   * database, so `via: () => ['broadcast']` in a stock app was a TOTAL silent
   * drop. Laravel throws for an unknown channel; so do we.
   */
  test('an unregistered channel is reported, not silently skipped', async () => {
    const { channel, got } = capturingChannel()
    const manager = new NotificationManager().channel('array', channel)
    const user: Notifiable = { id: 1 }

    await expect(manager.send(user, new PingWithUnknownChannel())).rejects.toThrow(
      /No notification channel registered under "unregistered"/,
    )
    // The channels that DO exist still delivered — one bad name doesn't lose them.
    expect(got).toEqual([user])
  })

  test('sendMany fans out to every notifiable', async () => {
    const { channel, got } = capturingChannel()
    const manager = new NotificationManager().channel('array', channel)
    const users: Notifiable[] = [{ id: 1 }, { id: 2 }]
    await manager.sendMany(users, new Ping())
    expect(got).toEqual(users)
  })
})

describe('default manager + notify()', () => {
  test('notifications() lazily creates one; setDefaultNotifications swaps it', () => {
    const first = notifications()
    expect(first).toBeInstanceOf(NotificationManager)
    expect(notifications()).toBe(first)
    const replacement = new NotificationManager()
    setDefaultNotifications(replacement)
    expect(notifications()).toBe(replacement)
  })

  test('notify() dispatches through the default manager for one or many', async () => {
    const { channel, got } = capturingChannel()
    setDefaultNotifications(new NotificationManager().channel('array', channel))
    await notify({ id: 1 }, new Ping())
    await notify([{ id: 2 }, { id: 3 }], new Ping())
    expect(got.map(u => u.id)).toEqual([1, 2, 3])
  })
})
