/**
 * The evaluator behind `elyvel tinker` — the part of a REPL that is actually
 * hard, kept free of any terminal so it can be tested like a function.
 *
 * Bun has no `node:repl`, and a naive `eval` loop fails the very first thing
 * anyone types into a tinker session:
 *
 *   const user = await User.find(1)   // ← `await` needs an async wrapper…
 *   user.email                        // ← …and `const` dies with that wrapper.
 *
 * Every line therefore runs inside an AsyncFunction (so `await` always works)
 * whose scope is a `with` block over a Proxy. The proxy traps every free
 * identifier: reads fall through to the shared context and then to real
 * globals; writes land in the context — which is what makes a variable from one
 * line visible on the next. Top-level `const`/`let`/`var` are rewritten to bare
 * assignments so they hit the proxy instead of dying with the wrapper's scope.
 */

const AsyncFunction = (async () => {}).constructor as new (...args: string[]) => Function

/** The names a session has defined, for the `.vars` command and tests. */
export function contextNames(context: object): string[] {
  return Object.keys(context).sort()
}

/**
 * A REPL context: reads resolve here first, then on `globalThis`; every write
 * lands here. `Object.create(null)` so a session variable named `constructor`
 * can't collide with Object.prototype.
 */
export function createReplContext(seed: Record<string, unknown> = {}): Record<string, unknown> {
  const store = Object.assign(Object.create(null) as Record<string, unknown>, seed)
  return new Proxy(store, {
    // `with` consults `has` for every free identifier — claiming them all is
    // what routes both reads and writes through this proxy.
    has: () => true,
    get: (target, key) => {
      // Symbol.unscopables must NOT be claimed, or `with` would refuse to
      // resolve anything through the proxy at all.
      if (key === Symbol.unscopables)
        return undefined
      if (key in target)
        return target[key as string]
      return (globalThis as Record<PropertyKey, unknown>)[key]
    },
    set: (target, key, value) => {
      target[key as string] = value
      return true
    },
  }) as Record<string, unknown>
}

/**
 * Rewrites declarations that would otherwise be scoped to (and die with) the
 * wrapper function, so they become proxy-trapped assignments instead:
 *
 *   const user = …            → user = …
 *   const { User } = await …  → ({ User } = await …)   // via the expression attempt
 *   class Foo {}              → Foo = class Foo {}
 *   function greet() {}       → greet = function greet() {}
 *
 * Deliberately top-level only — a `const` inside a block the user typed is
 * theirs and behaves normally.
 */
function rewriteDeclarations(code: string): string {
  const declaration = /^(?:const|let|var)\s+/.exec(code)
  if (declaration)
    return code.slice(declaration[0].length)

  const classDecl = /^class\s+([A-Z_$][\w$]*)/i.exec(code)
  if (classDecl)
    return `${classDecl[1]} = ${code}`

  const fnDecl = /^(?:async\s+)?function\s*(?:\*\s*)?([A-Z_$][\w$]*)/i.exec(code)
  if (fnDecl)
    return `${fnDecl[1]} = ${code}`

  return code
}

/** Thrown when the input is an unfinished statement — the REPL keeps reading. */
export class IncompleteInputError extends Error {}

/** Does this syntax error mean "keep typing" rather than "you made a typo"? */
function looksIncomplete(error: unknown): boolean {
  return error instanceof SyntaxError
    && /unexpected end of (?:input|script)|unterminated/i.test(error.message)
}

/**
 * Evaluate one REPL line against a context. Returns the line's value —
 * expression-first (so `user.email` echoes), statements as the fallback. The
 * result is also stored as `_`, the way every REPL spells "the last thing".
 */
export async function evaluateLine(code: string, context: Record<string, unknown>): Promise<unknown> {
  const prepared = rewriteDeclarations(code.trim())

  // Expression first: `return (x = 5)` persists, `({ User } = await import(…))`
  // is a valid destructuring expression, and plain reads echo their value.
  // The newline before `)` keeps a trailing `// comment` from eating it.
  const attempts = [`return (${prepared}\n)`, prepared]

  let syntaxError: unknown
  for (const body of attempts) {
    let fn: Function
    try {
      fn = new AsyncFunction('__elyvel_ctx', `with (__elyvel_ctx) { ${body} }`)
    }
    catch (error) {
      syntaxError = error
      continue
    }
    const value = await (fn as (ctx: object) => Promise<unknown>)(context)
    if (value !== undefined)
      context._ = value
    return value
  }

  if (looksIncomplete(syntaxError))
    throw new IncompleteInputError()
  throw syntaxError
}
