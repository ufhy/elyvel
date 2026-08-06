## File storage (@elyvel/storage)

- `storage()` is the default disk, `storage('s3')` a named one from
  `config/storage.ts` (local, public, s3-compatible).
- Use the disk API (`put`, `get`, `delete`, `url`, `exists`) rather than
  `node:fs` — that is what makes the code work unchanged against S3.
- Never build a public URL by string concatenation; ask the disk for it.
- Tests: `fakeStorage()` swaps in an in-memory disk.
