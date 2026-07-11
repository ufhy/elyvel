import { Hash } from '@elysia-ravel/auth'
import { Seeder } from '@elysia-ravel/eloquent'
import { User } from '../../app/models/User'

export class DatabaseSeeder extends Seeder {
  override async run(): Promise<void> {
    if ((await User.query().count()) > 0) return // idempotent

    await User.create({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: await Hash.make('password'),
    })
    await User.create({
      name: 'Alan Turing',
      email: 'alan@example.com',
      password: await Hash.make('password'),
    })
  }
}

export default DatabaseSeeder
