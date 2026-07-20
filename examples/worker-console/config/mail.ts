import { defineMailConfig } from '@elyvel/mail'

/**
 * `log` writes every outgoing message to the app log instead of sending it —
 * no SMTP server needed to see JobCompletedNotification fire for real.
 */
export default defineMailConfig({
  default: 'log',
  from: { email: 'worker-console@example.test', name: 'Worker Console' },
  mailers: {
    log: { transport: 'log' },
  },
})
