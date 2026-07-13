import { Notification } from '@elysia-ravel/notifications'

/** An in-app (database) notification shown after a user registers. */
export class WelcomeNotification extends Notification {
  constructor(private readonly name: string) {
    super()
  }
  via(): string[] {
    return ['database', 'broadcast']
  }
  override toDatabase() {
    return { message: `Welcome aboard, ${this.name}!`, kind: 'welcome' }
  }
  override toBroadcast() {
    return { message: `Welcome aboard, ${this.name}!`, kind: 'welcome' }
  }
}
