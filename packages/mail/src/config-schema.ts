import type { SmtpOptions } from './transports'

export type MailTransportConfig
  = | { transport: 'log' }
    | { transport: 'array' }
    | ({ transport: 'smtp' } & SmtpOptions)

export interface MailConfig {
  /** Default mailer name. Defaults to `log`. */
  default?: string
  /** Global default From address. */
  from?: { email: string, name?: string }
  mailers?: Record<string, MailTransportConfig>
}

/** Typed identity helper for `config/mail.ts`. */
export function defineMailConfig(config: MailConfig): MailConfig {
  return config
}
