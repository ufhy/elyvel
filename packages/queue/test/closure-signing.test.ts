import { afterEach, describe, expect, test } from 'bun:test'
import {
  hasClosureSigningKey,
  packSignedClosure,
  setClosureSigningKey,
  signClosure,
  unpackSignedClosure,
  verifyClosure,
} from '../src/closure-signing'
import { CallQueuedClosure } from '../src/job'

/**
 * A queued closure is executed with `new Function` on the worker. Anyone able
 * to write a queue row would otherwise have arbitrary code execution there, so
 * every one of these paths must fail CLOSED — a signature that is missing, is
 * wrong, or was made with a different key is indistinguishable from an
 * injected payload.
 */
afterEach(() => setClosureSigningKey(null))

describe('signing', () => {
  test('a signed source verifies', () => {
    setClosureSigningKey('key-one')
    const source = '() => 1 + 1'
    expect(() => verifyClosure(source, signClosure(source))).not.toThrow()
  })

  test('tampering with the source is rejected', () => {
    setClosureSigningKey('key-one')
    const signature = signClosure('() => 1 + 1')
    expect(() => verifyClosure('() => process.exit(1)', signature)).toThrow('does not match')
  })

  test('a signature from a different key is rejected', () => {
    setClosureSigningKey('key-one')
    const signature = signClosure('() => 1 + 1')
    setClosureSigningKey('key-two')
    expect(() => verifyClosure('() => 1 + 1', signature)).toThrow('does not match')
  })

  test('no signature at all is rejected, not treated as trusted', () => {
    setClosureSigningKey('key-one')
    expect(() => verifyClosure('() => 1 + 1', undefined)).toThrow('unsigned')
    expect(() => verifyClosure('() => 1 + 1', '')).toThrow('unsigned')
  })

  test('with no key configured, signing and verifying both refuse', () => {
    expect(hasClosureSigningKey()).toBe(false)
    expect(() => signClosure('() => 1')).toThrow('application key')
    expect(() => verifyClosure('() => 1', 'anything')).toThrow('application key')
  })
})

describe('packed envelope (batch callbacks)', () => {
  test('round-trips the source', () => {
    setClosureSigningKey('key-one')
    const source = '(batch) => console.log(batch.id)'
    expect(unpackSignedClosure(packSignedClosure(source))).toBe(source)
  })

  test('a source containing dots survives — only the first one separates', () => {
    setClosureSigningKey('key-one')
    const source = '(batch) => batch.id.toString().length'
    expect(unpackSignedClosure(packSignedClosure(source))).toBe(source)
  })

  test('a raw unsigned string (pre-signing, or hand-written into the store) is refused', () => {
    setClosureSigningKey('key-one')
    expect(() => unpackSignedClosure('() => process.exit(1)')).toThrow(/unsigned|does not match/)
  })

  test('swapping the payload behind a valid signature is refused', () => {
    setClosureSigningKey('key-one')
    const packed = packSignedClosure('(batch) => 1')
    const signature = packed.slice(0, packed.indexOf('.'))
    expect(() => unpackSignedClosure(`${signature}.(batch) => process.exit(1)`)).toThrow('does not match')
  })
})

describe('CallQueuedClosure', () => {
  test('runs a properly signed closure', async () => {
    setClosureSigningKey('key-one')
    const source = '() => { globalThis.__closureRan = true }'
    await new CallQueuedClosure(source, signClosure(source)).handle()
    expect((globalThis as Record<string, unknown>).__closureRan).toBe(true)
    delete (globalThis as Record<string, unknown>).__closureRan
  })

  test('refuses to run a job whose source was swapped in the store', () => {
    setClosureSigningKey('key-one')
    const signature = signClosure('() => {}')
    const injected = new CallQueuedClosure('() => { globalThis.__pwned = true }', signature)

    expect(() => injected.handle()).toThrow('does not match')
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined()
  })
})
