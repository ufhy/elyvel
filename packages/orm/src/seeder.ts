/**
 * Base class for database seeders. Implement `run()` using models — the
 * default connection is already booted when a seeder executes.
 *
 * Compose seeders by calling `this.call(OtherSeeder)` from a root
 * `DatabaseSeeder`, mirroring Laravel.
 */
export abstract class Seeder {
  abstract run(): void | Promise<void>

  /** Run another seeder from within this one. */
  protected async call(seeder: SeederClass): Promise<void> {
    await new seeder().run()
  }
}

export type SeederClass = new () => Seeder

/** Instantiate and run a list of seeders in order. */
export async function runSeeders(seeders: SeederClass[]): Promise<void> {
  for (const seeder of seeders) {
    await new seeder().run()
  }
}
