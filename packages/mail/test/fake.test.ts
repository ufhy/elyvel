import type { Message } from '../src/message'
import { afterEach, describe, expect, test } from 'bun:test'
import { fakeMail, restoreMail } from '../src/fake'
import { Mailable } from '../src/mailable'
import { Mail, MailManager } from '../src/manager'

class WelcomeMail extends Mailable {
  constructor(private readonly name: string) {
    super()
  }

  build(m: Message): void {
    m.subject('Welcome').html(`<h1>Hi ${this.name}</h1>`)
  }
}

class InvoiceMail extends Mailable {
  build(m: Message): void {
    m.subject('Invoice')
  }
}

afterEach(() => restoreMail(new MailManager()))

/**
 * Laravel's `Mail::fake()`. The `array` transport existed, but it records at the
 * wrong layer: it must be swapped in via config, and offers no assertions — a
 * test digs through an array and writes its own failure message. The fake
 * replaces the manager, so every path in is captured and nothing leaves the
 * process.
 */
describe('fakeMail', () => {
  test('captures Mail.to(...).send(mailable) without sending anything', async () => {
    const mail = fakeMail()
    await Mail.to('ada@example.com').send(new WelcomeMail('Ada'))

    mail.assertSent(WelcomeMail)
    mail.assertSentTo('ada@example.com')
    mail.assertSentCount(1)
  })

  test('assertSent matches by Mailable class, not by accident', async () => {
    const mail = fakeMail()
    await Mail.to('a@example.com').send(new WelcomeMail('A'))

    mail.assertNotSent(InvoiceMail)
    expect(() => mail.assertSent(InvoiceMail)).toThrow(/\[InvoiceMail\] to have been sent/)
  })

  test('a predicate sees the built message', async () => {
    const mail = fakeMail()
    await Mail.to('a@example.com').send(new WelcomeMail('Ada'))

    mail.assertSent(m => m.subjectLine === 'Welcome')
    mail.assertSent(WelcomeMail, m => (m.htmlBody ?? '').includes('Hi Ada'))
    expect(() => mail.assertSent(WelcomeMail, m => m.subjectLine === 'Wrong')).toThrow()
  })

  test('a fluent send with no Mailable is captured too', async () => {
    const mail = fakeMail()
    await Mail.to('ops@example.com').subject('alert').text('disk full').send()

    mail.assertSent(m => m.subjectLine === 'alert')
  })

  test('assertNothingSent fails loudly and names what WAS sent', async () => {
    const mail = fakeMail()
    await Mail.to('a@example.com').send(new WelcomeMail('A'))

    expect(() => mail.assertNothingSent()).toThrow(/"Welcome" to a@example\.com/)
  })

  test('assertSentTimes counts', async () => {
    const mail = fakeMail()
    await Mail.to('a@example.com').send(new WelcomeMail('A'))
    await Mail.to('b@example.com').send(new WelcomeMail('B'))

    mail.assertSentTimes(WelcomeMail, 2)
    expect(() => mail.assertSentTimes(WelcomeMail, 1)).toThrow(/2 time/)
  })

  test('assertSentTo checks cc and bcc as well', async () => {
    const mail = fakeMail()
    await Mail.to('a@example.com').cc('c@example.com').bcc('d@example.com').subject('x').send()

    mail.assertSentTo('c@example.com')
    mail.assertSentTo('d@example.com')
    expect(() => mail.assertSentTo('nobody@example.com')).toThrow(/none was sent to that address/)
  })
})
