import type { MailConfig, MailTransportConfig } from './config-schema'
import type { Mailable } from './mailable'
import type { Address } from './message'
import type { Transport } from './transports'
import { Message } from './message'
import { ArrayTransport, LogTransport, SmtpTransport } from './transports'

/** Resolves configured transports and delivers messages (Laravel's MailManager). */
export class MailManager {
  private readonly resolved = new Map<string, Transport>()
  private readonly defaultName: string

  constructor(private readonly config: MailConfig = {}) {
    this.defaultName = config.default ?? 'log'
  }

  transport(name?: string): Transport {
    const key = name ?? this.defaultName
    let transport = this.resolved.get(key)
    if (!transport) {
      transport = this.build(key)
      this.resolved.set(key, transport)
    }
    return transport
  }

  private build(name: string): Transport {
    const cfg: MailTransportConfig | undefined
      = this.config.mailers?.[name] ?? (name === 'log' ? { transport: 'log' } : undefined)
    if (!cfg)
      throw new Error(`[elyvel] Mail transport "${name}" is not defined in config/mail.ts.`)
    switch (cfg.transport) {
      case 'array':
        return new ArrayTransport()
      case 'smtp':
        return new SmtpTransport(cfg)
      default:
        return new LogTransport()
    }
  }

  /** Deliver a message, applying the global default From when none is set. */
  async deliver(message: Message, transportName?: string): Promise<void> {
    if (!message.fromAddress && this.config.from)
      message.from(this.config.from)
    await this.transport(transportName).send(message)
  }

  /** Start composing a message on this manager. */
  compose(transportName?: string): PendingMail {
    return new PendingMail(this, transportName)
  }
}

/** A fluent, one-off message builder that delivers via the manager. */
export class PendingMail {
  private readonly message = new Message()
  constructor(
    private readonly manager: MailManager,
    private readonly transportName?: string,
  ) {}

  to(...a: Address[]): this {
    this.message.to(...a)
    return this
  }

  cc(...a: Address[]): this {
    this.message.cc(...a)
    return this
  }

  bcc(...a: Address[]): this {
    this.message.bcc(...a)
    return this
  }

  from(a: Address): this {
    this.message.from(a)
    return this
  }

  replyTo(a: Address): this {
    this.message.replyTo(a)
    return this
  }

  subject(s: string): this {
    this.message.subject(s)
    return this
  }

  html(body: string | { render(shared: never): string }): this {
    this.message.html(body)
    return this
  }

  text(body: string): this {
    this.message.text(body)
    return this
  }

  /** Send now. Pass a Mailable to let it configure the message first. */
  async send(mailable?: Mailable): Promise<void> {
    if (mailable)
      await mailable.build(this.message)
    await this.manager.deliver(this.message, this.transportName)
  }
}

// ── process-wide default (set by MailServiceProvider at boot) ────────────────
let defaultManager: MailManager | null = null
export function setDefaultMailer(manager: MailManager): void {
  defaultManager = manager
}
export function mailManager(): MailManager {
  if (!defaultManager)
    defaultManager = new MailManager()
  return defaultManager
}

/** The Mail helper (Laravel's `Mail` facade). */
export const Mail = {
  to(...addresses: Address[]): PendingMail {
    return mailManager()
      .compose()
      .to(...addresses)
  },
  mailer(name: string): PendingMail {
    return mailManager().compose(name)
  },
  /** Send a Mailable directly (it must set its own recipients). */
  send(mailable: Mailable): Promise<void> {
    return mailManager().compose().send(mailable)
  },
}

/** The default mail manager (Laravel's `mail()`). */
export function mail(): MailManager {
  return mailManager()
}
