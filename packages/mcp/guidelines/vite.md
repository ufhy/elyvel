## Vite (@elyvel/vite)

- Development runs TWO processes: the elyvel server and `bun run dev` for
  Vite. If the user doesn't see a frontend change (or the app errors about a
  missing dev server/manifest), the Vite side isn't running or the build is
  stale — ask them to run `bun run dev` (or `bun run build` for production).
- Asset tags come from the framework's Vite integration (hot file in
  development, manifest in production) — never hand-write `<script src>` tags
  to built assets.
