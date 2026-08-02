import type { Transport } from '../src/transports'
import { describe, expect, test } from 'bun:test'
import { MailManager } from '../src/manager'
import { Message } from '../src/message'

/** A transport the framework has never heard of — the whole point. */
class ResendLike implements Transport {
  readonly sent: string[] = []
  constructor(private readonly apiKey: string) {}
  async send(message: Message): Promise<void> {
    this.sent.push(`${this.apiKey}:${message.subjectLine ?? ''}`)
  }
}

function message(): Message {
  return new Message().from('a@example.com').to('b@example.com').subject('hi').text('body')
}

/**
 * Transports used to be chosen by a `switch` over `'smtp' | 'log' | 'array'`, so
 * adding SES, Mailgun or Resend meant a pull request against the framework. The
 * `Transport` interface was public the whole time — you could write a driver, you
 * just couldn't register one.
 */
describe('MailManager.extend', () => {
  test('a registered transport is resolvable from config', async () => {
    const manager = new MailManager({
      default: 'resend',
      mailers: { resend: { transport: 'resend', apiKey: 'key_123' } },
    })
    const transport = new ResendLike('key_123')
    manager.extend('resend', () => transport)

    await manager.deliver(message())
    expect(transport.sent).toEqual(['key_123:hi'])
  })

  test('the factory receives the mailer config and its name', () => {
    const manager = new MailManager({ mailers: { custom: { transport: 'custom', flag: 7 } } })
    let seen: unknown
    manager.extend('custom', (cfg, name) => {
      seen = { cfg, name }
      return new ResendLike('x')
    })
    manager.transport('custom')
    expect(seen).toEqual({ cfg: { transport: 'custom', flag: 7 }, name: 'custom' })
  })

  test('extending overrides a built-in of the same name', async () => {
    const manager = new MailManager({ default: 'log', mailers: { log: { transport: 'log' } } })
    const replacement = new ResendLike('patched')
    manager.extend('log', () => replacement)

    await manager.deliver(message())
    expect(replacement.sent).toHaveLength(1)
  })

  /**
   * Resolved transports are cached. Without invalidating that cache, extending
   * after something had already sent would appear to do nothing at all.
   */
  test('extending after a transport was already built still takes effect', async () => {
    const manager = new MailManager({ default: 'log', mailers: { log: { transport: 'log' } } })
    await manager.deliver(message()) // builds and caches the built-in

    const replacement = new ResendLike('late')
    manager.extend('log', () => replacement)
    await manager.deliver(message())

    expect(replacement.sent).toHaveLength(1)
  })

  test('an unknown transport names the ones that exist', () => {
    const manager = new MailManager({ mailers: { x: { transport: 'carrier-pigeon' } } })
    expect(() => manager.transport('x')).toThrow(/Available: array, log, smtp/)
  })

  test('availableTransports lists built-ins plus extensions', () => {
    const manager = new MailManager()
    manager.extend('resend', () => new ResendLike('k'))
    expect(manager.availableTransports()).toEqual(['array', 'log', 'resend', 'smtp'])
  })
})
