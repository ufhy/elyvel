#!/usr/bin/env bun
/**
 * Publish every workspace package to npm, in dependency order.
 *
 * Dry run by default — it will NOT publish unless you pass `--publish`:
 *
 *   bun run release              # dry run: checks everything, sends nothing
 *   bun run release --publish    # for real
 *
 * Safe to re-run. A version already on the registry is skipped, so a run that
 * fails at package 14 can be resumed without erroring on the 13 already up
 * (npm refuses to republish an existing version).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

interface Pkg {
  name: string
  version: string
  dir: string
  internal: string[]
  tag: string
  private?: boolean
}

const PACKAGES_DIR = 'packages'
const publishForReal = process.argv.includes('--publish')

function readPackages(): Map<string, Pkg> {
  const out = new Map<string, Pkg>()
  for (const entry of readdirSync(PACKAGES_DIR)) {
    const dir = join(PACKAGES_DIR, entry)
    let raw: string
    try {
      raw = readFileSync(join(dir, 'package.json'), 'utf8')
    }
    catch {
      continue
    }
    const d = JSON.parse(raw) as Record<string, any>
    const deps: Record<string, string> = { ...d.dependencies, ...d.peerDependencies }
    out.set(d.name, {
      name: d.name,
      version: d.version,
      dir,
      internal: Object.keys(deps).filter(k => k.startsWith('@elyvel/')),
      tag: d.publishConfig?.tag ?? 'latest',
      private: d.private,
    })
  }
  return out
}

/** Dependency order, so a package is never published before something it needs. */
function topoSort(pkgs: Map<string, Pkg>): Pkg[] {
  const order: Pkg[] = []
  const done = new Set<string>()
  const visiting = new Set<string>()

  const visit = (name: string, path: string[]): void => {
    if (done.has(name))
      return
    if (visiting.has(name))
      throw new Error(`Dependency cycle: ${[...path, name].join(' -> ')}`)
    visiting.add(name)
    const pkg = pkgs.get(name)
    for (const dep of pkg?.internal ?? []) {
      if (pkgs.has(dep))
        visit(dep, [...path, name])
    }
    visiting.delete(name)
    done.add(name)
    if (pkg)
      order.push(pkg)
  }

  for (const name of [...pkgs.keys()].sort()) visit(name, [])
  return order
}

async function run(cmd: string[], cwd?: string): Promise<{ ok: boolean, out: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { ok: code === 0, out: `${stdout}${stderr}`.trim() }
}

/** Is this exact version already on the registry? */
async function alreadyPublished(pkg: Pkg): Promise<boolean> {
  const { ok, out } = await run(['npm', 'view', `${pkg.name}@${pkg.version}`, 'version'])
  return ok && out.includes(pkg.version)
}

/**
 * The check that matters most: `bun pm pack` resolves `workspace:*` from the
 * LOCKFILE, not from package.json on disk. Bump a version without re-running
 * `bun install` and every cross-package dependency is published pointing at a
 * version that will never exist — every install then fails. So pack each package
 * and read back what the tarball actually says.
 */
/**
 * Directories in a package that look like runtime assets: anything top-level that
 * isn't source, tests, tooling, or build output. `dist/` is gitignored build junk
 * and must NOT ship.
 */
function assetDirs(dir: string): string[] {
  const ignored = new Set(['src', 'test', 'tests', 'node_modules', 'dist', 'coverage'])
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !ignored.has(entry.name) && !entry.name.startsWith('.'))
    .map(entry => entry.name)
}

async function verifyTarballs(order: Pkg[], version: string): Promise<string[]> {
  const scratch = mkdtempSync(join(tmpdir(), 'elyvel-release-'))
  const problems: string[] = []
  try {
    for (const pkg of order) {
      const packed = await run(['bun', 'pm', 'pack', '--destination', scratch], pkg.dir)
      if (!packed.ok) {
        problems.push(`${pkg.name}: pack failed — ${packed.out.split('\n').at(-1)}`)
        continue
      }
      const tgz = readdirSync(scratch).find(f => f.includes(pkg.name.replace('@elyvel/', 'elyvel-').replace('/', '-')))
      if (!tgz) {
        problems.push(`${pkg.name}: no tarball produced`)
        continue
      }
      const listing = await run(['tar', '-xzOf', join(scratch, tgz), 'package/package.json'])
      const inTarball = JSON.parse(listing.out) as Record<string, any>
      const deps: Record<string, string> = { ...inTarball.dependencies, ...inTarball.peerDependencies }

      // Runtime assets that live OUTSIDE src/ and so are easy to leave out of
      // `files`. This is not hypothetical: shipping `files: ["src"]` published a
      // CLI with no `templates/` (so `bun create @elyvel` failed outright) and
      // four packages with no `lang/` (so translations silently fell back to
      // English forever, with no error anywhere). Nothing in package.json points
      // at these directories, so checking `exports`/`bin` targets cannot catch it.
      const contents = await run(['tar', '-tzf', join(scratch, tgz)])
      const shipped = contents.out.split('\n')
      for (const asset of assetDirs(pkg.dir)) {
        if (!shipped.some(entry => entry.startsWith(`package/${asset}/`)))
          problems.push(`${pkg.name}: "${asset}/" exists but is missing from the tarball — add it to \`files\``)
      }

      if (inTarball.version !== version)
        problems.push(`${pkg.name}: tarball says ${inTarball.version}, expected ${version}`)
      for (const [dep, range] of Object.entries(deps)) {
        if (range.startsWith('workspace:'))
          problems.push(`${pkg.name}: "${dep}" still uses the workspace protocol`)
        else if (dep.startsWith('@elyvel/') && range !== version)
          problems.push(`${pkg.name}: depends on ${dep}@${range}, expected ${version} — run \`bun install\``)
      }
      rmSync(join(scratch, tgz))
    }
  }
  finally {
    rmSync(scratch, { recursive: true, force: true })
  }
  return problems
}

const pkgs = readPackages()
for (const [name, pkg] of pkgs) {
  if (pkg.private) {
    console.log(`- ${name}: private, skipping`)
    pkgs.delete(name)
  }
}

const order = topoSort(pkgs)
const versions = new Set(order.map(p => p.version))
if (versions.size !== 1) {
  console.error(`✗ Packages disagree on the version: ${[...versions].join(', ')}`)
  console.error('  Every package must share one version — cross-deps are pinned to it exactly.')
  process.exit(1)
}
const version = [...versions][0] as string
const tags = new Set(order.map(p => p.tag))

console.log(`${order.length} packages at ${version} (dist-tag: ${[...tags].join(', ')})`)
console.log(publishForReal ? '\nMODE: PUBLISHING FOR REAL\n' : '\nMODE: dry run — pass --publish to send\n')

console.log('Verifying what the tarballs actually contain…')
const problems = await verifyTarballs(order, version)
if (problems.length > 0) {
  console.error('✗ Not publishing — the packed output is wrong:')
  for (const p of problems) console.error(`   ${p}`)
  process.exit(1)
}
console.log('✓ every tarball is correct and self-consistent\n')

let published = 0
let skipped = 0
for (const [index, pkg] of order.entries()) {
  const label = `[${String(index + 1).padStart(2)}/${order.length}] ${pkg.name}`

  if (await alreadyPublished(pkg)) {
    console.log(`${label} — already on the registry at ${version}, skipping`)
    skipped++
    continue
  }

  const cmd = ['bun', 'publish', '--tag', pkg.tag]
  if (!publishForReal)
    cmd.push('--dry-run')

  const result = await run(cmd, pkg.dir)
  if (!result.ok) {
    console.error(`${label} — FAILED`)
    console.error(result.out.split('\n').map(l => `   ${l}`).join('\n'))
    console.error(`\nStopped at ${pkg.name}. Fix the cause and re-run — packages already up are skipped.`)
    process.exit(1)
  }
  console.log(`${label} — ${publishForReal ? 'published' : 'ok (dry run)'}`)
  published++
}

console.log(`\n${published} ${publishForReal ? 'published' : 'would publish'}, ${skipped} skipped`)
if (!publishForReal)
  console.log('Nothing was sent. Re-run with --publish when ready.')
