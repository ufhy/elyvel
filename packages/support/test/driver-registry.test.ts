import { describe, expect, test } from 'bun:test'
import { DriverRegistry } from '../src/driver-registry'

interface Cfg { size?: number }

function registry(): DriverRegistry<string, Cfg> {
  return new DriverRegistry<string, Cfg>('Test driver', 'See config/test.ts.')
    .register('memory', () => 'memory-driver')
    .register('file', (cfg, name) => `${name}:${cfg.size ?? 0}`)
}

/**
 * The point of this is what it makes possible outside the framework: every
 * subsystem used to choose its implementation with a `switch`, so a driver the
 * framework had not heard of could not be plugged in at all — you edited the
 * framework or went without. Laravel solves it with `Manager::extend()`.
 */
describe('DriverRegistry', () => {
  test('resolves a built-in, passing it the config and its own name', () => {
    expect(registry().resolve('file', { size: 3 })).toBe('file:3')
  })

  test('extend() adds a driver the framework never shipped', () => {
    const r = registry().extend('whatsapp', () => 'wa-driver')
    expect(r.resolve('whatsapp', {})).toBe('wa-driver')
    expect(r.names()).toContain('whatsapp')
  })

  /**
   * Replacing matters as much as adding: an app that needs a patched version of
   * a shipped driver would otherwise have to rename it everywhere it's
   * referenced, including in config it doesn't own.
   */
  test('a custom driver overrides a built-in of the same name', () => {
    expect(registry().extend('memory', () => 'patched').resolve('memory', {})).toBe('patched')
  })

  test('forget() restores the built-in', () => {
    const r = registry().extend('memory', () => 'patched')
    expect(r.forget('memory').resolve('memory', {})).toBe('memory-driver')
  })

  /**
   * The error is the whole diagnosis: a missing driver is nearly always a typo
   * or a package that was never installed, and neither is visible from
   * "unsupported driver" alone.
   */
  test('an unknown driver names the ones that exist, and where to look', () => {
    expect(() => registry().resolve('nope', {})).toThrow(/Test driver "nope" is not supported/)
    expect(() => registry().resolve('nope', {})).toThrow(/Available: file, memory/)
    expect(() => registry().resolve('nope', {})).toThrow(/See config\/test\.ts\./)
  })

  test('an empty registry says so rather than printing an empty list', () => {
    const empty = new DriverRegistry<string, Cfg>('Thing')
    expect(() => empty.resolve('x', {})).toThrow(/\(none registered\)/)
  })

  test('has() and names() see both kinds', () => {
    const r = registry().extend('sms', () => 'sms')
    expect(r.has('sms')).toBe(true)
    expect(r.has('memory')).toBe(true)
    expect(r.has('carrier-pigeon')).toBe(false)
    expect(r.names()).toEqual(['file', 'memory', 'sms'])
  })
})
