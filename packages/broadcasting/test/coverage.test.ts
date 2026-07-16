import { describe, expect, test } from 'bun:test'
import { ArrayBroadcaster, LogBroadcaster } from '../src/broadcaster'

/** Covers the LogBroadcaster + ArrayBroadcaster implementations (only the hub/broadcastable were tested). */

describe('LogBroadcaster', () => {
  test('formats channels/event/payload into a single log line', () => {
    const lines: string[] = []
    const b = new LogBroadcaster(l => lines.push(l))
    b.broadcast(['orders', 'admin'], 'OrderShipped', { id: 7 })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('[broadcast] channels=orders,admin event=OrderShipped {"id":7}')
  })

  test('defaults to console.log when no sink is given', () => {
    const original = console.log
    const captured: unknown[] = []
    console.log = (...args: unknown[]) => void captured.push(args[0])
    try {
      new LogBroadcaster().broadcast(['c'], 'E', {})
    }
    finally {
      console.log = original
    }
    expect(String(captured[0])).toContain('[broadcast] channels=c event=E')
  })
})

describe('ArrayBroadcaster', () => {
  test('records each broadcast in memory', () => {
    const b = new ArrayBroadcaster()
    b.broadcast(['c1'], 'A', { x: 1 })
    b.broadcast(['c2'], 'B', { y: 2 })
    expect(b.sent).toEqual([
      { channels: ['c1'], event: 'A', payload: { x: 1 } },
      { channels: ['c2'], event: 'B', payload: { y: 2 } },
    ])
  })
})
