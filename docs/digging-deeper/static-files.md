# Static Files

Serve a directory of plain files — uploaded images, a built frontend's
assets — under a URL prefix (Laravel's `public/` disk).

## Usage

```ts
import { staticFiles } from '@elyvel/core'

route().use(staticFiles({ dir: 'public/build', prefix: '/build' }))
```

Any request under `/build/*` is resolved against `public/build/` on disk
and streamed back with the right content type; a missing file 404s.

`dir` is relative to the process's working directory (or an absolute
path); `prefix` defaults to the root (`''`) if omitted.

::: tip Already wired for you
[Inertia & Vue](/basics/inertia) and the [SPA mode](/basics/spa) both call
`staticFiles()` internally to serve built Vite assets — you only need this
directly for your own extra static directories (e.g. user-uploaded public
images).
:::

## Path traversal is blocked

A request path that resolves outside `dir` (`../../etc/passwd`-style
traversal) gets a `403` instead of ever touching a file outside the
served directory — this is enforced unconditionally, not an opt-in.
