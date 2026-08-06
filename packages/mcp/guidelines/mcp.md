## elyvel MCP tools

This project runs the `elyvel-mcp` MCP server (registered in `.mcp.json`).
Prefer its tools over shell commands and over guessing — they read the live
application:

- `application-info` — installed @elyvel packages with exact versions, the
  database in use, and the models. Call it before writing code that depends on
  a package API.
- `database-schema` — real tables and columns from the live connection. Use it
  before writing migrations, models, or queries; never guess column names.
- `database-query` — one read-only SQL statement, rows back as JSON. Use this
  instead of writing ad-hoc scripts to inspect data. Writes are rejected.
- `list-routes` — every registered HTTP route with middleware/authorize
  metadata where recorded.
- `last-error` / `read-log-entries` — the application log. When the user says
  something broke, check `last-error` first; only recent entries are relevant.
- `tinker` — run TypeScript in the booted app (models and `config()` in scope,
  `await` works, variables persist between calls). For debugging and
  inspection; do not create or mutate records without explicit user approval —
  prefer tests with factories.
- `get-absolute-url` — the app's correct scheme/host/port. Use it before
  sharing any project URL with the user.
