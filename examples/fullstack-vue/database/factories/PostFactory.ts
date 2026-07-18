import { defineFactory } from '@elyvel/database'
import { faker } from '@faker-js/faker'
import { Post } from '../../app/models/Post'

/**
 * Produces only the *fillable* columns (`published`/`user_id`/`author_name`
 * are trusted server fields, not mass-assignable — see the Post model).
 * `published_at` in the past vs. future lets `BlogSeeder` demo both an
 * already-published post and one still waiting for the scheduler to flip it.
 */
export const postFactory = defineFactory(Post, (i) => {
  const title = faker.lorem.sentence({ min: 4, max: 8 }).replace(/\.$/, '')
  return {
    title,
    slug: `${faker.helpers.slugify(title).toLowerCase()}-${i}`,
    body: faker.lorem.paragraphs(3, '\n\n'),
    published_at: new Date(Date.now() - (i - 1) * 86_400_000).toISOString(),
  }
})
