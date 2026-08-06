import type { Notifiable } from '../src/notification'
import { afterEach, describe, expect, test } from 'bun:test'
import { fakeNotifications, restoreNotifications } from '../src/fake'
import { NotificationManager, notify } from '../src/manager'
import { Notification } from '../src/notification'

class OrderShipped extends Notification {
  constructor(readonly orderId: number) {
    super()
  }

  override via(): string[] {
    // A real channel that is never registered on the fake — deliberately: the
    // fake must capture regardless of channels, and run none of them.
    return ['mail', 'telegram']
  }
}

class PasswordChanged extends Notification {
  override via(): string[] {
    return ['mail']
  }
}

const user = (id: number): Notifiable => ({ id, constructor: Object } as unknown as Notifiable)

afterEach(() => restoreNotifications(new NotificationManager()))

/**
 * Laravel's `Notification::fake()`. `ArrayChannel` existed, but only captures
 * notifications whose `via()` includes `'array'` — observing a notification
 * meant rewriting it. The fake replaces the manager: everything is captured, and
 * no channel runs (no mail, no Telegram HTTP call, no database row).
 */
describe('fakeNotifications', () => {
  test('captures notify() without running any channel', async () => {
    const fake = fakeNotifications()
    const ada = user(1)

    // via() names 'mail' and 'telegram', neither registered — under the real
    // manager this would throw; under the fake it records.
    await notify(ada, new OrderShipped(42))

    fake.assertSentTo(ada, OrderShipped)
    fake.assertCount(1)
  })

  test('a predicate sees the notification instance', async () => {
    const fake = fakeNotifications()
    const ada = user(1)
    await notify(ada, new OrderShipped(42))

    fake.assertSentTo(ada, OrderShipped, n => (n as OrderShipped).orderId === 42)
    expect(() => fake.assertSentTo(ada, OrderShipped, n => (n as OrderShipped).orderId === 7)).toThrow()
  })

  test('recipients are told apart', async () => {
    const fake = fakeNotifications()
    const ada = user(1)
    const grace = user(2)
    await notify(ada, new OrderShipped(1))

    fake.assertSentTo(ada, OrderShipped)
    fake.assertNotSentTo(grace, OrderShipped)
    fake.assertNothingSentTo(grace)
  })

  /**
   * The test holds the user it created; the code under test usually re-fetches
   * its own instance of the same row. Reference equality alone would make every
   * such assertion fail for a reason that has nothing to do with the app.
   */
  test('a re-fetched instance of the same notifiable still matches', async () => {
    const fake = fakeNotifications()
    await notify(user(7), new PasswordChanged())

    fake.assertSentTo(user(7), PasswordChanged)
  })

  test('sendMany records one entry per recipient', async () => {
    const fake = fakeNotifications()
    await notify([user(1), user(2)], new PasswordChanged())

    fake.assertCount(2)
    fake.assertSentTo(user(1), PasswordChanged)
    fake.assertSentTo(user(2), PasswordChanged)
  })

  test('a failed assertion names what WAS sent', async () => {
    const fake = fakeNotifications()
    await notify(user(1), new PasswordChanged())

    expect(() => fake.assertSentTo(user(1), OrderShipped)).toThrow(/Sent: PasswordChanged/)
  })

  test('assertSentToTimes and assertNothingSent', async () => {
    const fake = fakeNotifications()
    fake.assertNothingSent()

    await notify(user(1), new PasswordChanged())
    await notify(user(1), new PasswordChanged())
    fake.assertSentToTimes(user(1), PasswordChanged, 2)
    expect(() => fake.assertNothingSent()).toThrow(/2 were/)
  })
})
