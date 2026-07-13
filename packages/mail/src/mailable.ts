import type { Message } from './message'

/**
 * A reusable email definition (Laravel's `Mailable`). Configure the message in
 * `build()`:
 *
 *   class WelcomeMail extends Mailable {
 *     constructor(private name: string) { super() }
 *     build(m: Message) { m.subject('Welcome').html(`<h1>Hi ${this.name}</h1>`) }
 *   }
 *   await Mail.to('a@b.com').send(new WelcomeMail('Sam'))
 */
export abstract class Mailable {
  abstract build(message: Message): void | Promise<void>
}
