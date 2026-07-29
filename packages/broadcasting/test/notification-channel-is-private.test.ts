import { describe, expect, test } from 'bun:test'
import { ArrayBroadcaster } from '../src/broadcaster'
import { BroadcastChannel } from '../src/channel'
import { setDefaultBroadcaster } from '../src/manager'

class WelcomeNotification {
  via(): string[] {
    return ['broadcast']
  }

  toBroadcast(): Record<string, unknown> {
    return { message: 'your invoice is ready' }
  }
}

/**
 * Regression: the default channel was `notifications.<key>` — no `private-`
 * prefix, so `BroadcastHub.isAuthorized` short-circuited to `true` and ANY
 * unauthenticated socket could send
 * `{"event":"subscribe","channel":"notifications.7"}` and read user 7's
 * notification payloads. Laravel uses a private channel here.
 * `BroadcastServiceProvider` registers the matching authorizer so the private
 * default is still usable out of the box.
 */
describe('the broadcast notification channel is private by default', () => {
  test('the default channel carries the private- prefix', async () => {
    const broadcaster = new ArrayBroadcaster()
    setDefaultBroadcaster(broadcaster)

    await new BroadcastChannel().send({ id: 7 } as any, new WelcomeNotification() as any)

    expect(broadcaster.sent).toHaveLength(1)
    expect(broadcaster.sent[0]!.channels).toEqual(['private-notifications.7'])
    // The old, publicly-subscribable name must not be used.
    expect(broadcaster.sent[0]!.channels[0]).not.toBe('notifications.7')
  })

  test('an explicit broadcast route on the notifiable still wins', async () => {
    const broadcaster = new ArrayBroadcaster()
    setDefaultBroadcaster(broadcaster)

    await new BroadcastChannel().send(
      { id: 7, routeNotificationFor: (channel: string) => (channel === 'broadcast' ? 'private-team.3' : undefined) } as any,
      new WelcomeNotification() as any,
    )

    expect(broadcaster.sent[0]!.channels).toEqual(['private-team.3'])
  })

  test('a notification without toBroadcast is not sent at all', async () => {
    const broadcaster = new ArrayBroadcaster()
    setDefaultBroadcaster(broadcaster)

    await new BroadcastChannel().send({ id: 7 } as any, { via: () => ['broadcast'] } as any)
    expect(broadcaster.sent).toHaveLength(0)
  })
})
