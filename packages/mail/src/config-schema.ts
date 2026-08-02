import type { SmtpOptions } from './transports'

export type MailTransportConfig
  = | { transport: 'log' }
    | { transport: 'array' }
    | ({ transport: 'smtp' } & SmtpOptions)
    /**
     * A transport registered with `MailManager.extend()`. The union stays
     * closed for the built-ins (so `transport: 'smpt'` is still a type error and
     * SMTP options still autocomplete) while leaving room for one the framework
     * has never heard of — otherwise a custom transport could be registered but
     * never configured.
     */
    | ({ transport: string } & Record<string, unknown>)

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
