/**
 * A CLI command a package contributes to `elyvel` — the command-side
 * counterpart to {@link ServiceProviderClass}/`elyvelProviders`. A package
 * opts in by exporting `elyvelCommands: ConsoleCommand[]` from its main
 * entry; `elyvel package:discover` picks it up the same way it already
 * picks up `elyvelProviders`, generating `bootstrap/commands.generated.ts`
 * so `@elyvel/cli` never needs to depend on the package itself.
 */
export interface ConsoleCommand {
  /** e.g. `'queue:work'`. */
  name: string
  /** One-line description shown in `elyvel help`. */
  description: string
  /** Usage suffix shown after the name in `elyvel help`, e.g. `'<id> | --all'`. */
  usage?: string
  run(flags: Record<string, string | boolean>, args: string[]): number | Promise<number>
}
