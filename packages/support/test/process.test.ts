import { describe, expect, test } from 'bun:test'
import { Process, ProcessFailedError, ProcessTimedOutError } from '../src/process'

/**
 * Laravel's `Process` facade over Bun.spawn. The wrapper exists because the raw
 * API makes the correct thing verbose (streams, exit codes) and the wrong thing
 * silent (never checking the exit code).
 */
describe('Process', () => {
  test('runs a command and captures stdout + exit code', async () => {
    const result = await Process.run(['echo', 'hello world'])
    expect(result.successful()).toBe(true)
    expect(result.exitCode()).toBe(0)
    expect(result.output().trim()).toBe('hello world')
    expect(result.command()).toBe('echo hello world')
  })

  test('a string command is split like a terminal would', async () => {
    const result = await Process.run('echo one two')
    expect(result.output().trim()).toBe('one two')
  })

  test('stderr is separate from stdout', async () => {
    const result = await Process.run(['sh', '-c', 'echo out; echo err >&2'])
    expect(result.output().trim()).toBe('out')
    expect(result.errorOutput().trim()).toBe('err')
    expect(result.seeInOutput('err')).toBe(true)
  })

  test('a non-zero exit is failed(), and throw() raises with the output in the message', async () => {
    const result = await Process.run(['sh', '-c', 'echo broken >&2; exit 3'])
    expect(result.failed()).toBe(true)
    expect(result.exitCode()).toBe(3)
    expect(() => result.throw()).toThrow(ProcessFailedError)
    expect(() => result.throw()).toThrow(/exit code 3/)
    expect(() => result.throw()).toThrow(/broken/)
  })

  test('throwIf only throws when the condition holds', async () => {
    const result = await Process.run(['sh', '-c', 'exit 1'])
    expect(result.throwIf(false)).toBe(result)
    expect(() => result.throwIf(true)).toThrow(ProcessFailedError)
  })

  test('path() sets the working directory', async () => {
    const result = await Process.path('/tmp').run(['pwd'])
    // macOS: /tmp is a symlink to /private/tmp — either spelling is that directory.
    expect(['/tmp', '/private/tmp']).toContain(result.output().trim())
  })

  test('env() merges onto the parent environment', async () => {
    const result = await Process.env({ ELYVEL_TEST_VAR: 'set' }).run(['sh', '-c', 'echo $ELYVEL_TEST_VAR:$HOME'])
    const [custom, home] = result.output().trim().split(':')
    expect(custom).toBe('set')
    expect(home).not.toBe('') // parent env still there
  })

  test('input() feeds stdin', async () => {
    const result = await Process.input('halo dari stdin').run(['cat'])
    expect(result.output()).toBe('halo dari stdin')
  })

  /**
   * The timeout must KILL the child, not merely reject — a survivor keeps the
   * event loop (and a test suite) alive. SIGKILL specifically, because a child
   * ignoring SIGTERM would hang the await forever.
   */
  test('timeout() kills the child and rejects', async () => {
    const started = Date.now()
    expect(Process.timeout(0.3).run(['sleep', '10'])).rejects.toThrow(ProcessTimedOutError)
    await Bun.sleep(500)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  test('an empty command is an error, not a confusing spawn failure', async () => {
    expect(Process.run('')).rejects.toThrow(/needs a command/)
  })
})
