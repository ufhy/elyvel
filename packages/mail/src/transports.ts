import type { Message } from './message'
import { formatAddress } from './message'

/** A mail transport — turns a composed {@link Message} into a delivered email. */
export interface Transport {
  send(message: Message): Promise<void>
}

/** Writes emails to the logger instead of sending them (dev default). */
export class LogTransport implements Transport {
  constructor(private readonly log: (line: string) => void = l => console.log(l)) {}
  async send(message: Message): Promise<void> {
    const to = message.toAddresses.map(formatAddress).join(', ')
    this.log(
      `[mail] to=${to} subject=${JSON.stringify(message.subjectLine)}\n${message.htmlBody ?? message.textBody ?? ''}`,
    )
  }
}

/** Collects sent emails in memory (tests). */
export class ArrayTransport implements Transport {
  readonly sent: Message[] = []
  async send(message: Message): Promise<void> {
    this.sent.push(message)
  }
}

export interface SmtpOptions {
  host: string
  port?: number
  secure?: boolean
  auth?: { user: string, pass: string }
  /** Default From when a message doesn't set one. */
  from?: string
}

/**
 * Sends over SMTP via nodemailer (an established, battle-tested mailer). Install
 * `nodemailer` to use it — it's an optional dependency so the package stays lean.
 */
export class SmtpTransport implements Transport {
  constructor(private readonly options: SmtpOptions) {}
  async send(message: Message): Promise<void> {
    let nodemailer: typeof import('nodemailer')
    try {
      nodemailer = await import('nodemailer')
    }
    catch {
      throw new Error('[elyvel] SMTP transport needs `nodemailer` installed.')
    }
    const transporter = nodemailer.createTransport({
      host: this.options.host,
      port: this.options.port ?? 587,
      secure: this.options.secure ?? false,
      auth: this.options.auth,
    })
    const info = await transporter.sendMail({
      from: message.fromAddress ? formatAddress(message.fromAddress) : this.options.from,
      to: message.toAddresses.map(formatAddress),
      cc: message.ccAddresses.map(formatAddress),
      bcc: message.bccAddresses.map(formatAddress),
      replyTo: message.replyToAddress ? formatAddress(message.replyToAddress) : undefined,
      subject: message.subjectLine,
      html: message.htmlBody,
      text: message.textBody,
      headers: message.headers,
      attachments: message.attachments.map(a => ({
        filename: a.filename,
        content: typeof a.content === 'string' ? a.content : Buffer.from(a.content),
        contentType: a.contentType,
      })),
    })
    // `sendMail` RESOLVES when the server accepted some recipients and rejected
    // others — discarding its result meant a mail that reached nobody (or only
    // half the list) was reported as sent, so `MailManager.deliver` never
    // recorded a failure and the caller had no way to know.
    const rejected = (info as { rejected?: unknown[] } | undefined)?.rejected ?? []
    if (rejected.length > 0) {
      throw new Error(
        `[elyvel] SMTP rejected ${rejected.length} recipient(s): ${rejected.map(String).join(', ')}`,
      )
    }
  }
}
