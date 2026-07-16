import { route } from '@elysia-ravel/core'
import { storage } from '@elysia-ravel/storage'

/**
 * File uploads through the `storage()` helper. `putFile` streams the upload to
 * the `public` disk under a unique name and returns its public URL. `GET /files`
 * lists what's been stored; `GET /files/download/*` streams a file back.
 */
export default route()
  .post('/files', async ({ body }: any) => {
    const disk = storage('public')
    const path = await disk.putFile('uploads', body.file, 'public')
    return { path, url: disk.url(path), size: await disk.size(path) }
  })
  .get('/files', async () => ({ files: await storage('public').allFiles('uploads') }))
  .get('/files/download/*', ({ params, status }: any) => {
    const rel = params['*']
    // Reject path traversal before it reaches the disk (defense in depth).
    if (rel.includes('..'))
      return status(404, { message: 'Not found' })
    return storage('public').download(`uploads/${rel}`)
  })
