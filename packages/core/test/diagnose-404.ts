#!/usr/bin/env bun
/**
 * Temporary diagnostic: two `error-pages` tests assert 404 and get 200, but ONLY
 * on GitHub Actions. Not reproducible on macOS, nor in a Linux container, with or
 * without `.env`, on pinned or latest Bun, nor by replaying CI's file order.
 *
 * So print what the response actually IS on that runner. Delete once fixed.
 */
import { Elysia } from 'elysia'
import { errorPages } from '../src/http/error-pages'

async function show(label: string, app: any, path: string, accept: string): Promise<void> {
  const res = await app.handle(new Request(`http://localhost${path}`, { headers: { accept } }))
  const body = await res.text()
  console.log(`\n── ${label}`)
  console.log(`   status : ${res.status}`)
  console.log(`   headers: ${JSON.stringify(Object.fromEntries(res.headers))}`)
  console.log(`   body   : ${JSON.stringify(body.slice(0, 160))}`)
}

const plain = new Elysia().use(errorPages()).get('/ok', () => ({ ok: true }))
await show('unmatched /missing (expect 404)', plain, '/missing', 'text/html')
await show('unmatched /missing as JSON (expect 404)', plain, '/missing', 'application/json')

const returned = new Elysia()
  .use(errorPages())
  .get('/post', ({ status }: any) => status(404, { message: 'Post not found' }))
await show('returned status(404) (expect 404)', returned, '/post', 'text/html')

console.log(`\nbun ${Bun.version} · ${process.platform}/${process.arch} · cores=${navigator.hardwareConcurrency}`)
