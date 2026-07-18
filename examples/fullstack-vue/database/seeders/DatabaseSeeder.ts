import { Seeder } from '@elyvel/database'
import { BlogSeeder } from './BlogSeeder'

export class DatabaseSeeder extends Seeder {
  override async run(): Promise<void> {
    await this.call(BlogSeeder)
  }
}

export default DatabaseSeeder
