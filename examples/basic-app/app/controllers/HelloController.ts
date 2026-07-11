import { Elysia, t } from 'elysia'

/**
 * HelloController — an Elysia plugin. It stays fully type-safe: params and
 * responses are inferred/validated by Elysia's schema, no magic.
 */
export default new Elysia({ name: 'hello', prefix: '/hello' })
  .get('/', () => ({ message: 'Hello from elysia-ravel' }))
  .get('/:name', ({ params }) => ({ message: `Hello, ${params.name}` }), {
    params: t.Object({ name: t.String() }),
  })
