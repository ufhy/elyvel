/** An email address — a bare string or `{ email, name }`. */
export type Address = string | { email: string; name?: string }

export interface Attachment {
  filename: string
  content: string | Uint8Array
  contentType?: string
}

/** A mutable email being composed (Laravel's `Message`). */
export class Message {
  fromAddress?: Address
  readonly toAddresses: Address[] = []
  readonly ccAddresses: Address[] = []
  readonly bccAddresses: Address[] = []
  replyToAddress?: Address
  subjectLine = ''
  htmlBody?: string
  textBody?: string
  readonly attachments: Attachment[] = []
  readonly headers: Record<string, string> = {}

  from(address: Address): this {
    this.fromAddress = address
    return this
  }
  to(...addresses: Address[]): this {
    this.toAddresses.push(...addresses)
    return this
  }
  cc(...addresses: Address[]): this {
    this.ccAddresses.push(...addresses)
    return this
  }
  bcc(...addresses: Address[]): this {
    this.bccAddresses.push(...addresses)
    return this
  }
  replyTo(address: Address): this {
    this.replyToAddress = address
    return this
  }
  subject(subject: string): this {
    this.subjectLine = subject
    return this
  }
  /** Set the HTML body — a string, or anything with `render()` (a view). */
  html(body: string | { render: (shared: never) => string }): this {
    this.htmlBody = typeof body === 'string' ? body : body.render(EMPTY_SHARED as never)
    return this
  }
  text(body: string): this {
    this.textBody = body
    return this
  }
  attach(attachment: Attachment): this {
    this.attachments.push(attachment)
    return this
  }
  header(name: string, value: string): this {
    this.headers[name] = value
    return this
  }
}

// A view rendered for mail has no request/session — supply empty shared data.
const EMPTY_SHARED = {
  errors: {},
  old: (_k: string, d?: unknown) => d,
  flash: (_k: string, d?: unknown) => d,
  csrf: '',
  globals: {},
}

/** Normalize an address to RFC "Name <email>" (or just the email). */
export function formatAddress(address: Address): string {
  if (typeof address === 'string') return address
  return address.name ? `${address.name} <${address.email}>` : address.email
}
