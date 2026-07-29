import { describe, expect, test } from 'bun:test'
import { formatAddress, Message } from '../src/message'

/**
 * Fills message.ts gaps by exercising every fluent builder directly (the
 * from/cc/bcc/replyTo/attach/header setters were only partly covered), plus
 * the formatAddress helper.
 */

describe('Message — fluent builders', () => {
  test('every setter records onto the message', () => {
    const m = new Message()
      .from('from@b.com')
      .to('a@b.com')
      .cc('c@b.com')
      .bcc('audit@b.com', { email: 'log@b.com', name: 'Log' })
      .replyTo({ email: 'reply@b.com', name: 'Reply' })
      .subject('Subject')
      .html('<p>Hello</p>')
      .text('Hello')
      .attach({ filename: 'note.txt', content: 'hi', contentType: 'text/plain' })
      .header('X-Campaign', 'welcome')

    expect(m.fromAddress).toBe('from@b.com')
    expect(m.toAddresses).toEqual(['a@b.com'])
    expect(m.ccAddresses).toEqual(['c@b.com'])
    expect(m.bccAddresses).toEqual(['audit@b.com', { email: 'log@b.com', name: 'Log' }])
    expect(m.replyToAddress).toEqual({ email: 'reply@b.com', name: 'Reply' })
    expect(m.subjectLine).toBe('Subject')
    expect(m.htmlBody).toBe('<p>Hello</p>')
    expect(m.textBody).toBe('Hello')
    expect(m.attachments).toHaveLength(1)
    expect(m.attachments[0]?.filename).toBe('note.txt')
    expect(m.headers['X-Campaign']).toBe('welcome')
  })
})

describe('formatAddress', () => {
  test('bare string passes through; object renders "Name <email>" or just the email', () => {
    expect(formatAddress('x@y.com')).toBe('x@y.com')
    expect(formatAddress({ email: 'x@y.com' })).toBe('x@y.com')
    // The name is always quoted — see the injection regression below.
    expect(formatAddress({ email: 'x@y.com', name: 'Ex' })).toBe('"Ex" <x@y.com>')
  })

  // Regression: the display name was interpolated raw into `Name <email>`, and
  // nodemailer re-parses that string. A name carrying its own angle brackets
  // therefore REPLACED the recipient — verified against a real SMTP server,
  // `to({email:'victim@x.test', name:'Doe, John <attacker@evil.test>'})`
  // produced a single `RCPT TO: attacker@evil.test`, the intended recipient
  // was dropped, and `send()` still reported success. Display names come from
  // user-editable profile fields, so anyone could redirect their own mail.
  describe('formatAddress neutralizes a hostile display name', () => {
    test('angle brackets in the name cannot take over the address', () => {
      const out = formatAddress({ email: 'victim@x.test', name: 'Doe, John <attacker@evil.test>' })
      // The real recipient is the last address, outside the quoted name.
      expect(out.endsWith('<victim@x.test>')).toBe(true)
      expect(out).toBe('"Doe, John <attacker@evil.test>" <victim@x.test>')
    })

    test('quotes and backslashes in the name are escaped, not left to close the quoting', () => {
      expect(formatAddress({ email: 'a@b.test', name: 'He said "hi"' }))
        .toBe('"He said \\"hi\\"" <a@b.test>')
      expect(formatAddress({ email: 'a@b.test', name: 'back\\slash' }))
        .toBe('"back\\\\slash" <a@b.test>')
    })

    test('CR/LF in the name cannot inject headers', () => {
      const out = formatAddress({ email: 'a@b.test', name: 'X\r\nBcc: evil@evil.test' })
      expect(out).not.toContain('\r')
      expect(out).not.toContain('\n')
      expect(out).toBe('"X Bcc: evil@evil.test" <a@b.test>')
    })
  })
})
