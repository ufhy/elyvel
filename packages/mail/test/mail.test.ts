import { describe, expect, test } from 'bun:test'
import { SMTPServer } from 'smtp-server'
import { Mailable } from '../src/mailable'
import { Mail, MailManager, setDefaultMailer } from '../src/manager'
import { Message } from '../src/message'
import { ArrayTransport, LogTransport, SmtpTransport } from '../src/transports'

describe('array transport + fluent Mail', () => {
  test('captures the composed message', async () => {
    const manager = new MailManager({ default: 'array', mailers: { array: { transport: 'array' } } })
    setDefaultMailer(manager)
    await Mail.to('a@b.com').cc({ email: 'c@b.com', name: 'Cee' }).subject('Hi').html('<p>Hello</p>').send()

    const sent = (manager.transport('array') as ArrayTransport).sent
    expect(sent).toHaveLength(1)
    expect(sent[0]?.subjectLine).toBe('Hi')
    expect(sent[0]?.toAddresses).toEqual(['a@b.com'])
    expect(sent[0]?.htmlBody).toBe('<p>Hello</p>')
  })

  test('applies the global default From', async () => {
    const manager = new MailManager({
      default: 'array',
      from: { email: 'no-reply@app.test', name: 'App' },
      mailers: { array: { transport: 'array' } },
    })
    setDefaultMailer(manager)
    await Mail.to('a@b.com').subject('X').text('hi').send()
    expect((manager.transport('array') as ArrayTransport).sent[0]?.fromAddress).toEqual({
      email: 'no-reply@app.test',
      name: 'App',
    })
  })
})

describe('Mailable', () => {
  class WelcomeMail extends Mailable {
    constructor(private readonly name: string) {
      super()
    }
    build(m: Message): void {
      m.subject(`Welcome ${this.name}`).html(`<h1>Hi ${this.name}</h1>`)
    }
  }

  test('build() configures the message', async () => {
    const manager = new MailManager({ default: 'array', mailers: { array: { transport: 'array' } } })
    setDefaultMailer(manager)
    await Mail.to('sam@x.test').send(new WelcomeMail('Sam'))
    const sent = (manager.transport('array') as ArrayTransport).sent[0]
    expect(sent?.subjectLine).toBe('Welcome Sam')
    expect(sent?.htmlBody).toContain('Hi Sam')
  })
})

describe('log transport', () => {
  test('writes the email to the log sink', async () => {
    const lines: string[] = []
    const message = new Message().to('a@b.com').subject('Report').text('body')
    await new LogTransport((l) => lines.push(l)).send(message)
    expect(lines[0]).toContain('to=a@b.com')
    expect(lines[0]).toContain('Report')
  })
})

// ── real local SMTP round-trip (smtp-server + nodemailer via SmtpTransport) ────
describe('SMTP transport (live, local)', () => {
  test('delivers to a local SMTP server', async () => {
    let raw = ''
    const server = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS', 'AUTH'],
      onData(stream, _session, callback) {
        stream.on('data', (c: Buffer) => {
          raw += c.toString()
        })
        stream.on('end', () => callback())
      },
    })
    const port = 2526
    await new Promise<void>((resolve) => server.listen(port, resolve))
    try {
      const transport = new SmtpTransport({ host: 'localhost', port, secure: false })
      const message = new Message().from('sender@app.test').to('rcpt@x.test').subject('Live SMTP').html('<b>hi</b>')
      await transport.send(message)
      expect(raw).toContain('Subject: Live SMTP')
      expect(raw).toContain('rcpt@x.test')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
