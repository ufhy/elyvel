/**
 * Running external processes — Laravel's `Process` facade, on `Bun.spawn`.
 *
 * `Bun.spawn` is capable but low-level: reading stdout is a stream dance, a
 * timeout is a hand-rolled race that must also kill the child, and forgetting to
 * check `exitCode` is silent. This wraps the ten lines everyone writes (and the
 * three everyone gets subtly wrong) behind the API Laravel users already know.
 *
 * ```ts
 * const result = await Process.run(['git', 'status', '--porcelain'])
 * if (result.successful()) console.log(result.output())
 *
 * await Process.path('/repo').timeout(60).run('bun run build').then(r => r.throw())
 * ```
 */

export class ProcessFailedError extends Error {
  constructor(readonly result: ProcessResult) {
    super(
      `Process failed with exit code ${result.exitCode()}: ${result.command()}\n`
      + `${result.errorOutput() || result.output() || '(no output)'}`,
    )
    this.name = 'ProcessFailedError'
  }
}

export class ProcessTimedOutError extends Error {
  constructor(command: string, seconds: number) {
    super(`Process timed out after ${seconds}s: ${command}`)
    this.name = 'ProcessTimedOutError'
  }
}

export class ProcessResult {
  constructor(
    private readonly cmd: string,
    private readonly code: number,
    private readonly stdout: string,
    private readonly stderr: string,
  ) {}

  command(): string {
    return this.cmd
  }

  exitCode(): number {
    return this.code
  }

  successful(): boolean {
    return this.code === 0
  }

  failed(): boolean {
    return this.code !== 0
  }

  output(): string {
    return this.stdout
  }

  errorOutput(): string {
    return this.stderr
  }

  seeInOutput(text: string): boolean {
    return this.stdout.includes(text) || this.stderr.includes(text)
  }

  /** Throw a {@link ProcessFailedError} when the process failed; chainable otherwise. */
  throw(): this {
    if (this.failed())
      throw new ProcessFailedError(this)
    return this
  }

  throwIf(condition: boolean): this {
    return condition ? this.throw() : this
  }
}

interface ProcessOptions {
  cwd?: string
  env?: Record<string, string>
  timeoutSeconds?: number
  input?: string
}

/** Fluent builder — `Process.path(dir).timeout(30).env({...}).run(cmd)`. */
export class PendingProcess {
  private readonly options: ProcessOptions

  constructor(options: ProcessOptions = {}) {
    this.options = options
  }

  /** Working directory for the child. */
  path(cwd: string): PendingProcess {
    return new PendingProcess({ ...this.options, cwd })
  }

  /**
   * Kill the child and reject with {@link ProcessTimedOutError} after this many
   * seconds. There is deliberately NO default: a build may take ten minutes, and
   * an arbitrary default turns slow-but-correct into flaky.
   */
  timeout(seconds: number): PendingProcess {
    return new PendingProcess({ ...this.options, timeoutSeconds: seconds })
  }

  /** Extra environment variables, merged over the parent's. */
  env(environment: Record<string, string>): PendingProcess {
    return new PendingProcess({ ...this.options, env: environment })
  }

  /** Text written to the child's stdin (then closed). */
  input(text: string): PendingProcess {
    return new PendingProcess({ ...this.options, input: text })
  }

  /**
   * Run to completion. A string command is split on whitespace — for shell
   * features (pipes, globs) spawn a shell explicitly: `['sh', '-c', '…']`.
   * Nothing here passes through a shell otherwise, so arguments cannot be
   * injected into one.
   */
  async run(command: string | string[]): Promise<ProcessResult> {
    const argv = typeof command === 'string' ? command.split(/\s+/).filter(Boolean) : command
    const shown = argv.join(' ')
    if (argv.length === 0)
      throw new Error('[elyvel] Process.run() needs a command.')

    const child = Bun.spawn(argv, {
      cwd: this.options.cwd,
      env: this.options.env ? { ...process.env, ...this.options.env } : undefined,
      stdin: this.options.input !== undefined ? new TextEncoder().encode(this.options.input) : undefined,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    let timer: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    if (this.options.timeoutSeconds !== undefined) {
      timer = setTimeout(() => {
        timedOut = true
        // SIGKILL, not SIGTERM: a child that ignores SIGTERM would keep the
        // await below (and the test suite above it) hanging forever.
        child.kill(9)
      }, this.options.timeoutSeconds * 1000)
    }

    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      if (timedOut)
        throw new ProcessTimedOutError(shown, this.options.timeoutSeconds!)
      return new ProcessResult(shown, exitCode, stdout, stderr)
    }
    finally {
      if (timer)
        clearTimeout(timer)
    }
  }
}

/**
 * The `Process` namespace, mirroring Laravel's facade. Every builder method is
 * also reachable statically: `Process.path(...)`, `Process.timeout(...)`.
 */
export const Process = {
  run: (command: string | string[]) => new PendingProcess().run(command),
  path: (cwd: string) => new PendingProcess().path(cwd),
  timeout: (seconds: number) => new PendingProcess().timeout(seconds),
  env: (environment: Record<string, string>) => new PendingProcess().env(environment),
  input: (text: string) => new PendingProcess().input(text),
}
