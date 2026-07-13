import { defineMailConfig } from '@elysia-ravel/mail'

/**
 * Mail config. `log` writes emails to the logger (dev default); `smtp` sends via
 * nodemailer. Send with the `Mail` helper: `await Mail.to(x).subject(..).html(..).send()`.
 */
export default defineMailConfig({
  default: process.env.MAIL_MAILER ?? 'log',
  from: { email: process.env.MAIL_FROM ?? 'no-reply@example.com', name: 'Basic App' },
  mailers: {
    log: { transport: 'log' },
    array: { transport: 'array' },
    smtp: {
      transport: 'smtp',
      host: process.env.MAIL_HOST ?? 'localhost',
      port: Number(process.env.MAIL_PORT ?? 1025),
      secure: false,
    },
  },
})
