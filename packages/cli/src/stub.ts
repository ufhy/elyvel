import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const stubsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'stubs')

/** Render a stub by substituting `{{key}}` placeholders from `vars`. */
export async function renderStub(
  name: string,
  vars: Record<string, string | undefined>,
): Promise<string> {
  const template = await Bun.file(join(stubsDir, `${name}.stub`)).text()
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? '')
}

/**
 * Write `contents` to `target`, creating parent dirs. Refuses to overwrite an
 * existing file so a generator never clobbers user code.
 */
export async function writeGenerated(target: string, contents: string): Promise<void> {
  if (existsSync(target)) {
    throw new Error(`File already exists: ${target}`)
  }
  await mkdir(dirname(target), { recursive: true })
  await Bun.write(target, contents)
}

export { join }
