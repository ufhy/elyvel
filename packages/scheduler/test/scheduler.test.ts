import { describe, expect, test } from 'bun:test'
import { cronMatches, parseCron, parseCronField } from '../src/cron'
import { ScheduledEvent, setSchedulerEnvironment } from '../src/event'
import { Schedule } from '../src/schedule'

// ── cron field parsing ────────────────────────────────────────────────────────
describe('parseCronField', () => {
  test('wildcard expands to full range', () => {
    expect([...parseCronField('*', 0, 5)]).toEqual([0, 1, 2, 3, 4, 5])
  })
  test('list, range, and step', () => {
    expect([...parseCronField('1,3,5', 0, 59)]).toEqual([1, 3, 5])
    expect([...parseCronField('1-4', 0, 59)]).toEqual([1, 2, 3, 4])
    expect([...parseCronField('*/15', 0, 59)]).toEqual([0, 15, 30, 45])
    expect([...parseCronField('10-20/5', 0, 59)]).toEqual([10, 15, 20])
  })
  test('rejects out-of-range and bad steps', () => {
    expect(() => parseCronField('99', 0, 59)).toThrow()
    expect(() => parseCronField('*/0', 0, 59)).toThrow()
  })
})

describe('parseCron', () => {
  test('requires 5 fields', () => {
    expect(() => parseCron('* * * *')).toThrow(/5 fields/)
  })
  test('normalizes Sunday-as-7 to 0', () => {
    expect(parseCron('* * * * 7').dayOfWeek.has(0)).toBe(true)
  })
})

// ── cron matching (UTC-anchored dates) ────────────────────────────────────────
describe('cronMatches', () => {
  // 2026-07-13 is a Monday.
  const monday0800 = new Date('2026-07-13T08:00:00Z')
  const monday0805 = new Date('2026-07-13T08:05:00Z')
  const sunday = new Date('2026-07-12T00:00:00Z')

  test('every minute always matches', () => {
    expect(cronMatches('* * * * *', monday0800, 'UTC')).toBe(true)
  })
  test('specific minute/hour', () => {
    expect(cronMatches('0 8 * * *', monday0800, 'UTC')).toBe(true)
    expect(cronMatches('0 8 * * *', monday0805, 'UTC')).toBe(false)
  })
  test('step minute', () => {
    expect(cronMatches('*/5 * * * *', monday0805, 'UTC')).toBe(true)
    expect(cronMatches('*/5 * * * *', new Date('2026-07-13T08:03:00Z'), 'UTC')).toBe(false)
  })
  test('day-of-week', () => {
    expect(cronMatches('0 0 * * 0', sunday, 'UTC')).toBe(true) // Sunday
    expect(cronMatches('0 0 * * 1-5', sunday, 'UTC')).toBe(false) // weekday only
    expect(cronMatches('0 8 * * 1', monday0800, 'UTC')).toBe(true) // Monday
  })
  test('dom OR dow when both restricted', () => {
    // day-of-month 1 (no) OR Monday (yes) → matches
    expect(cronMatches('0 8 1 * 1', monday0800, 'UTC')).toBe(true)
    // day-of-month 1 (no) OR Tuesday (no) → no match
    expect(cronMatches('0 8 1 * 2', monday0800, 'UTC')).toBe(false)
  })
})

// ── frequency builders ─────────────────────────────────────────────────────────
describe('ScheduledEvent frequencies', () => {
  const expr = (build: (e: ScheduledEvent) => ScheduledEvent) => build(new ScheduledEvent(() => {})).expression
  test('common frequencies build the right cron', () => {
    expect(expr((e) => e.everyMinute())).toBe('* * * * *')
    expect(expr((e) => e.everyFiveMinutes())).toBe('*/5 * * * *')
    expect(expr((e) => e.hourly())).toBe('0 * * * *')
    expect(expr((e) => e.hourlyAt(15))).toBe('15 * * * *')
    expect(expr((e) => e.daily())).toBe('0 0 * * *')
    expect(expr((e) => e.dailyAt('13:30'))).toBe('30 13 * * *')
    expect(expr((e) => e.weekly())).toBe('0 0 * * 0')
    expect(expr((e) => e.weeklyOn(1, '09:00'))).toBe('0 9 * * 1')
    expect(expr((e) => e.monthly())).toBe('0 0 1 * *')
    expect(expr((e) => e.monthlyOn(15, '06:00'))).toBe('0 6 15 * *')
    expect(expr((e) => e.quarterly())).toBe('0 0 1 1,4,7,10 *')
    expect(expr((e) => e.yearly())).toBe('0 0 1 1 *')
    expect(expr((e) => e.weekdays())).toBe('* * * * 1-5')
    expect(expr((e) => e.weekends())).toBe('* * * * 0,6')
    expect(expr((e) => e.days(1, 3, 5))).toBe('* * * * 1,3,5')
  })
  test('cron() sets a raw expression and validates arity', () => {
    expect(expr((e) => e.cron('5 4 * * *'))).toBe('5 4 * * *')
    expect(() => new ScheduledEvent(() => {}).cron('bad')).toThrow(/5 fields/)
  })
})

// ── constraints ─────────────────────────────────────────────────────────────
describe('when / skip / withoutOverlapping', () => {
  const monday0800 = new Date('2026-07-13T08:00:00Z')

  test('when gates execution', async () => {
    const ev = new ScheduledEvent(() => {}).cron('0 8 * * *').timezone('UTC').when(() => false)
    expect(ev.isDue(monday0800)).toBe(true)
    expect(await ev.shouldRun(monday0800)).toBe(false)
  })
  test('skip prevents execution', async () => {
    const ev = new ScheduledEvent(() => {}).cron('0 8 * * *').timezone('UTC').skip(() => true)
    expect(await ev.shouldRun(monday0800)).toBe(false)
  })
  test('withoutOverlapping blocks a concurrent run', async () => {
    let running = false
    let overlapped = false
    const ev = new ScheduledEvent(async () => {
      if (running) overlapped = true
      running = true
      await new Promise((r) => setTimeout(r, 20))
      running = false
    })
      .named('lock-test')
      .withoutOverlapping()
    const [a, b] = await Promise.all([ev.run(), ev.run()])
    expect(overlapped).toBe(false)
    expect([a, b].filter(Boolean).length).toBe(1) // one ran, one was blocked
  })
})

// ── lifecycle hooks ───────────────────────────────────────────────────────────
describe('lifecycle hooks', () => {
  test('before / onSuccess / after fire on success', async () => {
    const trace: string[] = []
    const ev = new ScheduledEvent(() => void trace.push('task'))
      .before(() => void trace.push('before'))
      .onSuccess(() => void trace.push('success'))
      .after(() => void trace.push('after'))
    await ev.run()
    expect(trace).toEqual(['before', 'task', 'success', 'after'])
  })

  test('onFailure + after fire on error (and error rethrows)', async () => {
    const trace: string[] = []
    const ev = new ScheduledEvent(() => {
      throw new Error('boom')
    })
      .onSuccess(() => void trace.push('success'))
      .onFailure((e) => void trace.push(`failure:${(e as Error).message}`))
      .after(() => void trace.push('after'))
    await expect(ev.run()).rejects.toThrow('boom')
    expect(trace).toEqual(['failure:boom', 'after'])
  })
})

// ── time windows / environments / background ──────────────────────────────────
describe('between / unlessBetween / environments / background', () => {
  const monday0800 = new Date('2026-07-13T08:00:00Z')

  test('between gates by time-of-day', async () => {
    const inWindow = new ScheduledEvent(() => {}).everyMinute().timezone('UTC').between('08:00', '09:00')
    const outWindow = new ScheduledEvent(() => {}).everyMinute().timezone('UTC').between('09:00', '10:00')
    expect(await inWindow.shouldRun(monday0800)).toBe(true)
    expect(await outWindow.shouldRun(monday0800)).toBe(false)
  })

  test('unlessBetween is the inverse', async () => {
    const ev = new ScheduledEvent(() => {}).everyMinute().timezone('UTC').unlessBetween('08:00', '09:00')
    expect(await ev.shouldRun(monday0800)).toBe(false)
  })

  test('overnight between window wraps midnight', async () => {
    const night = new Date('2026-07-13T23:30:00Z')
    const ev = new ScheduledEvent(() => {}).everyMinute().timezone('UTC').between('22:00', '02:00')
    expect(await ev.shouldRun(night)).toBe(true)
  })

  test('environments restricts to matching env', async () => {
    setSchedulerEnvironment('production')
    const prod = new ScheduledEvent(() => {}).everyMinute().environments('production')
    const local = new ScheduledEvent(() => {}).everyMinute().environments('local')
    expect(await prod.shouldRun(monday0800)).toBe(true)
    expect(await local.shouldRun(monday0800)).toBe(false)
  })

  test('runInBackground does not block the run', async () => {
    let done = false
    const s = new Schedule()
    s.call(async () => {
      await new Promise((r) => setTimeout(r, 20))
      done = true
    })
      .everyMinute()
      .runInBackground()
    const results = await s.run(monday0800)
    expect(results[0]?.ran).toBe(true)
    expect(done).toBe(false) // not awaited
    await new Promise((r) => setTimeout(r, 40))
    expect(done).toBe(true)
  })
})

// ── Schedule.run ─────────────────────────────────────────────────────────────
describe('Schedule.run', () => {
  const monday0800 = new Date('2026-07-13T08:00:00Z')

  test('runs only due tasks and collects results', async () => {
    const ran: string[] = []
    const s = new Schedule()
    s.call(() => void ran.push('due')).cron('0 8 * * *').timezone('UTC').named('due')
    s.call(() => void ran.push('not-due')).cron('0 9 * * *').timezone('UTC').named('not-due')

    const results = await s.run(monday0800)
    expect(ran).toEqual(['due'])
    expect(results).toHaveLength(1)
    expect(results[0]?.name).toBe('due')
    expect(results[0]?.ran).toBe(true)
  })

  test('captures task errors without aborting the run', async () => {
    const ran: string[] = []
    const s = new Schedule()
    s.call(() => {
      throw new Error('kaboom')
    })
      .everyMinute()
      .named('boom')
    s.call(() => void ran.push('after')).everyMinute().named('after')

    const results = await s.run(monday0800)
    expect(ran).toEqual(['after'])
    expect(results.find((r) => r.name === 'boom')?.error).toBeInstanceOf(Error)
  })

  test('dueEvents filters by cron only', () => {
    const s = new Schedule()
    s.call(() => {}).cron('0 8 * * *').timezone('UTC')
    s.call(() => {}).cron('0 9 * * *').timezone('UTC')
    expect(s.dueEvents(monday0800)).toHaveLength(1)
  })
})
