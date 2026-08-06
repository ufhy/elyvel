## Notifications (@elyvel/notifications)

- A notification class declares `via()` returning the channels, plus a
  `toMail`/`toDatabase`/`toTelegram`… method per channel. Send with
  `notify(notifiable, new InvoicePaid(invoice))`.
- `via()` may return channel CLASSES, not just names — that is how a
  third-party channel is used, with no registration step.
- Database notifications need their table; read the notifications docs before
  adding one by hand.
- Queue a notification rather than sending inline when it hits the network.
- Tests: `fakeNotifications()` + `assertSentTo`.
