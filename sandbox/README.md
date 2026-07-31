# sandbox/

Scratch space for testing the **published** `@elyvel/*` packages — the ones on
npm, installed the way a user installs them.

It exists separately from `playground/` for one reason: `playground/*` is a
workspace glob in the root `package.json`, so anything created directly inside it
becomes a workspace member. A package manager then resolves `@elyvel/*` to the
local sources instead of the registry, and `npm install` fails outright with
`Unsupported URL Type "workspace:"` — it walks up, finds the monorepo, and hits
the `workspace:*` ranges it cannot parse. That is the monorepo talking, not a
problem with the published packages.

`sandbox/` is in no workspace glob, so installs here behave exactly like a
stranger's machine:

```sh
cd sandbox
bun create @elyvel my-app     # or: npm install @elyvel/core@<version>
```

Contents are gitignored; this file and `.gitignore` are not.

**If `bun create @elyvel` fails with a missing export** (for example
`Export named 'trimTrailing' not found in module '.../@elyvel/support/src/index.ts'`),
the cause is a stale bunx cache, not the release. bunx reuses
`$TMPDIR/bunx-*-@elyvel/create@latest/node_modules` and can leave a transitive
package behind at an old version while updating the rest. Fix it with:

```sh
rm -rf "$TMPDIR"/bunx-*@elyvel*
```

Pinning the version (`bun create @elyvel@0.1.0-alpha.3 my-app`) also sidesteps it,
because it resolves under a different cache key.
