/**
 * Base class for database seeders. Implement `run()` using models. Compose with
 * `this.call(OtherSeeder)` from a root `DatabaseSeeder`, mirroring Laravel.
 */
export abstract class Seeder {
  abstract run(): void | Promise<void>

  protected async call(seeder: SeederClass): Promise<void> {
    await new seeder().run()
  }
}

export type SeederClass = new () => Seeder

export async function runSeeders(seeders: SeederClass[]): Promise<void> {
  for (const seeder of seeders) await new seeder().run()
}
