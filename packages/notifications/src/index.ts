import { NotificationServiceProvider } from './provider'

export {
  ArrayChannel,
  type Channel,
  configureDatabaseNotifications,
  DatabaseChannel,
  MailChannel,
  type NotificationDbAdapter,
  type StoredNotification,
  TelegramChannel,
} from './channels'
export {
  configureFailedNotifications,
  type FailedNotificationAdapter,
  type FailedNotificationRecord,
  FailedNotificationRepository,
  failedNotifications,
  MemoryFailedNotificationStore,
} from './failed'
export {
  NotificationManager,
  notifications,
  notify,
  setDefaultNotifications,
} from './manager'
export {
  type ChannelClass,
  type Notifiable,
  notifiableKey,
  Notification,
  routeFor,
} from './notification'
export { NotificationServiceProvider, NotificationToken } from './provider'

/** Read by `elyvel package:discover` — see packages/core's discovery loader. */
export const elyvelProviders = [NotificationServiceProvider]
