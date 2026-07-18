import { defineFactory } from '@elyvel/database'
import { faker } from '@faker-js/faker'
import { Comment } from '../../app/models/Comment'

/** Produces only `body` (fillable) — `post_id`/`user_id`/`author_name` are set by the seeder. */
export const commentFactory = defineFactory(Comment, () => ({
  body: faker.lorem.sentences({ min: 1, max: 2 }),
}))
