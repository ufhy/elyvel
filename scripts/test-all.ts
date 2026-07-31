#!/usr/bin/env bun
/**
 * Run the suite one package at a time, each in its own `bun test` process.
 *
 * A single `bun test` over the whole repo shares one process, so module-level
 * state set by one package's tests leaks into every package that runs after it.
 * That is not theoretical: the full-repo run fails 2 tests on a 2-core machine
 * and a DIFFERENT 2 on an 8-core one — same code, same Bun, same Elysia; only the
 * file interleaving changes, so the victim changes with it. Each package passes
 * on its own.
 *
 * A process per package makes the run deterministic and pins the blame to one
 * package when something does break.
 *
 * This is the fix, not a stopgap. A static audit found 95 test files calling one
 * of 60+ module-level setters (`setConnection`, `registerMiddlewareRegistry`,
 * `configureErrorPage`, `setDefault*`, …) without resetting it — the pattern is
 * systemic, and making every global reset-safe across all of them would be far
 * more work and risk than isolating the processes. Within a package the shared
 * state is intentional: tests configure what they need.
 *
 * `bun run test` maps here. Plain `bun test` still works for a targeted run, but
 * over the WHOLE repo it shares one process and is order-dependent — use
 * `bun run test` or `bun run test:one <path>` instead.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

interface Result {
  dir: string
  pass: number
  fail: number
  ok: boolean
  ms: number
}

function suiteDirs(): string[] {
  const out: string[] = []
  for (const group of ['packages', 'examples']) {
    if (!existsSync(group))
      continue
    for (const entry of readdirSync(group).sort()) {
      const dir = join(group, entry, 'test')
      if (existsSync(dir))
        out.push(dir)
    }
  }
  return out
}

/** `bun test` reports " N pass" / " N fail" on their own lines at the end. */
function counts(output: string): { pass: number, fail: number } {
  const read = (label: string): number => {
    const match = output.match(new RegExp(`^\\s*(\\d+)\\s+${label}\\s*$`, 'm'))
    return match ? Number(match[1]) : 0
  }
  return { pass: read('pass'), fail: read('fail') }
}

const results: Result[] = []
for (const dir of suiteDirs()) {
  const startedAt = Bun.nanoseconds()
  const proc = Bun.spawn(['bun', 'test', dir], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  const output = `${stdout}${stderr}`
  const { pass, fail } = counts(output)
  const ok = code === 0
  const ms = Math.round((Bun.nanoseconds() - startedAt) / 1e6)
  results.push({ dir, pass, fail, ok, ms })

  // Timing per package, so a slow suite is attributable rather than a mystery —
  // the whole test step is ~80% of CI's wall clock.
  const seconds = `${(ms / 1000).toFixed(1)}s`.padStart(7)
  console.log(`${ok ? '✓' : '✗'} ${dir.padEnd(34)} ${String(pass).padStart(4)} pass${fail ? `  ${fail} fail` : ''}${seconds}`)
  if (!ok) {
    // Only the failing package's output, so the log stays readable.
    console.log(output.split('\n').filter(l => /\(fail\)|error:|Expected|Received/.test(l)).slice(0, 40).map(l => `    ${l}`).join('\n'))
  }
}

const pass = results.reduce((n, r) => n + r.pass, 0)
const fail = results.reduce((n, r) => n + r.fail, 0)
const broken = results.filter(r => !r.ok)

const totalMs = results.reduce((n, r) => n + r.ms, 0)
console.log(`\n${pass} pass, ${fail} fail across ${results.length} packages in ${(totalMs / 1000).toFixed(1)}s`)
const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 3)
console.log(`slowest: ${slowest.map(r => `${r.dir} ${(r.ms / 1000).toFixed(1)}s`).join(', ')}`)
if (broken.length > 0) {
  console.log(`failing: ${broken.map(r => r.dir).join(', ')}`)
  process.exit(1)
}
