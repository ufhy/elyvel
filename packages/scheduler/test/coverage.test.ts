import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test } from 'bun:test'
import { ScheduledEvent } from '../src/event'
import { Schedule, schedule, setDefaultSchedule } from '../src/schedule'

/**
 * Fills the gaps left by scheduler.test.ts: the remaining frequency/day
 * builders, the Schedule task kinds (job/exec/command + runShell success &
 * failure), and the default-schedule singleton.
 */

const outDir = mkdtempSync(join(tmpdir(), 'sched-cov-'))
afterAll(() => rmSync(outDir, { recursive: true, force: true }))

function expr(build: (e: ScheduledEvent) => ScheduledEvent): string {
  return build(new ScheduledEvent(() => {})).expression
}

describe('remaining frequency + day builders', () => {
  test('minute/day frequency variants build the right cron', () => {
    expect(expr(e => e.everyTwoMinutes())).toBe('*/2 * * * *')
    expect(expr(e => e.everyTenMinutes())).toBe('*/10 * * * *')
    expect(expr(e => e.everyThirtyMinutes())).toBe('*/30 * * * *')
    expect(expr(e => e.twiceDaily())).toBe('0 1,13 * * *')
    expect(expr(e => e.twiceDaily(6, 18))).toBe('0 6,18 * * *')
  })

  test('per-weekday helpers set the day-of-week field', () => {
    expect(expr(e => e.sundays())).toBe('* * * * 0')
    expect(expr(e => e.mondays())).toBe('* * * * 1')
    expect(expr(e => e.tuesdays())).toBe('* * * * 2')
    expect(expr(e => e.wednesdays())).toBe('* * * * 3')
    expect(expr(e => e.thursdays())).toBe('* * * * 4')
    expect(expr(e => e.fridays())).toBe('* * * * 5')
    expect(expr(e => e.saturdays())).toBe('* * * * 6')
  })
})

describe('Schedule task kinds', () => {
  const monday0800 = new Date('2026-07-13T08:00:00Z')

  test('job() runs a Runnable.handle() inline, named after its class', async () => {
    let ran = false
    class SendReports {
      async handle(): Promise<void> {
        ran = true
      }
    }
    const s = new Schedule()
    const ev = s.job(new SendReports()).everyMinute()
    expect(ev.name).toBe('SendReports')
    await s.run(monday0800)
    expect(ran).toBe(true)
  })

  test('exec() runs a shell command and captures its output', async () => {
    const file = join(outDir, 'exec.log')
    const s = new Schedule()
    s.exec('echo hello-exec').everyMinute().sendOutputTo(file)
    await s.run(monday0800)
    expect(readFileSync(file, 'utf8')).toContain('hello-exec')
  })

  test('exec() rejects when the command exits non-zero', async () => {
    const ev = new Schedule().exec('exit 3').everyMinute()
    await expect(ev.run(monday0800)).rejects.toThrow(/exit 3/)
  })

  test('command() registers a `elyvel <cmd>` event named accordingly', () => {
    const s = new Schedule()
    const ev = s.command('migrate --force')
    expect(ev.name).toBe('elyvel migrate --force')
    expect(s.events).toHaveLength(1)
  })
})

describe('default schedule singleton', () => {
  test('schedule() returns a lazily-created default; setDefaultSchedule swaps it', () => {
    const first = schedule()
    expect(first).toBeInstanceOf(Schedule)
    expect(schedule()).toBe(first) // cached
    const replacement = new Schedule()
    setDefaultSchedule(replacement)
    expect(schedule()).toBe(replacement)
  })
})
