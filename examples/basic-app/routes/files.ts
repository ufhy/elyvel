import { route } from '@elysia-ravel/core'
import { storage } from '@elysia-ravel/storage'

/**
 * File uploads through the `storage()` helper. `putFile` streams the upload to
 * the `public` disk under a unique name and returns its public URL. `GET /files`
 * lists what's been stored; `GET /files/download/*` streams a file back.
 */
export default route()
  // biome-ignore lint/suspicious/noExplicitAny: Elysia multipart body
  .post('/files', async ({ body }: any) => {
    const disk = storage('public')
    const path = await disk.putFile('uploads', body.file, 'public')
    return { path, url: disk.url(path), size: await disk.size(path) }
  })
  .get('/files', async () => ({ files: await storage('public').allFiles('uploads') }))
  // biome-ignore lint/suspicious/noExplicitAny: Elysia wildcard params
  .get('/files/download/*', ({ params }: any) =>
    storage('public').download(`uploads/${params['*']}`),
  )
