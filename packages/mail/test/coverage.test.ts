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
    expect(formatAddress({ email: 'x@y.com', name: 'Ex' })).toBe('Ex <x@y.com>')
  })
})
