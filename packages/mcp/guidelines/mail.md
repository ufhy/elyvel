## Mail (@elyvel/mail)

- Build a `Mailable` class (`elyvel make:mail` if present, otherwise extend
  `Mailable`) and send with `Mail.to(address).send(new OrderShipped(order))`.
- Transports come from `config/mail.ts`; the `log` transport writes the
  message to the log instead of sending, which is the right default locally.
- In tests use `fakeMail()` and its `assertSent` family — never point tests at
  a real transport.
