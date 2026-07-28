# Log Viewer

A self-contained web UI for browsing your app's own log files —
filter by level, full-text search, paginate, expand an entry for its
stack trace, download or delete a file. No build step, no Vue/React
dependency — it ships its own dark-themed HTML/CSS/JS page.

## Installation

```bash
bun add @elyvel/log-viewer
```

## Mounting it

```ts
// config/middleware.ts
import { logViewer } from '@elyvel/log-viewer'

export default defineMiddlewareConfig({
  global: [logViewer()],
})
```

```ts
logViewer({
  path: '/log-viewer',      // default
  logDir: 'storage/logs',   // default — resolved against cwd if relative
})
```

Routes it registers: `GET {path}` (the HTML shell), `GET
{path}/api/files` (list log files), `GET
{path}/api/files/:name/entries` (paginated, filterable entries — query
params `level`, `q`, `page`, `perPage`, `direction`), `GET
{path}/api/files/:name/download`, and `DELETE {path}/api/files/:name`.

## Gate it yourself — required

::: warning No default authorization
Unlike the debug error page, there's no environment-based default here —
with no `authorize` configured, **every request is denied**. You must
wire this explicitly, even in production, before the log viewer does
anything useful.
:::

```ts
import { configureLogViewer } from '@elyvel/log-viewer'

configureLogViewer({
  authorize: ctx => ADMIN_EMAILS.includes((ctx.user as User | null)?.email ?? ''),
})
```

`authorize(ctx)` returns (or resolves to) a boolean. A real app should
check a role/permission rather than an email allowlist — swap in
whatever your [Authorization](/security/authorization) setup already
uses.

## What it reads

It understands the active log file, size-rotated files (`app.log.1`),
and daily-rotated files (`app-2026-07-19.log`) — see
[Logging](/digging-deeper/logging) for how those get created. It does
**not** read gzip-compressed rotations (`FileTransport`'s `compress:
true`) — leave compression off for a log directory you want to browse
here.

JSON mode (one JSON object per line, the default) vs. pretty/text mode
(`pretty: true`) is auto-detected by sniffing the first line. In pretty
mode only `time`/`level`/`name`/`message` are parsed as structured
fields — everything else (context, stack traces) comes back verbatim as
raw text, since it may contain real newlines that can't be safely
re-parsed.

There's no on-disk index — each request loads the relevant file into
memory, which is fine at the default 5MB rotation size but not built for
browsing gigabyte-scale log archives.

## Testing

`resetLogViewerConfig()` clears the configured `authorize` function back
to "deny everything" — use it in `beforeEach` if a test suite configures
a custom one.
