## Testing (@elyvel/testing)

- Run tests with `bun test` (they are `bun:test` tests, not vitest/jest).
  Always run the suite after `eslint --fix` — the fixer can change logic.
- Write feature tests over HTTP with the testing package's request helpers and
  its assertion API; factories over hand-built records.
- Fakes exist for mail, queue, and notifications (`assertSent`,
  `assertPushed`, `assertSentTo`) — use them instead of intercepting real
  transports. Console commands are testable in-process with `runCommand`.
- Prefer a test proving the behaviour over a one-off verification script or
  tinker session.
