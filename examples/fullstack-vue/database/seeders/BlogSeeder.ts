import { Seeder } from '@elyvel/database'
import { commentFactory } from '../factories/CommentFactory'
import { postFactory } from '../factories/PostFactory'

// A stand-in author — Post/Comment only store a plain user_id/author_name (no
// Eloquent relation to Better Auth's own `users` table), so seeding doesn't
// need a real signed-up account.
const AUTHOR = { user_id: 'seed-author', author_name: 'Ada Lovelace', author_email: 'ada@example.com' }
const COMMENTER = { user_id: 'seed-commenter', author_name: 'Grace Hopper' }

export class BlogSeeder extends Seeder {
  override async run(): Promise<void> {
    const posts = await postFactory().count(5).create(AUTHOR)

    // First post is scheduled in the future — left unpublished so
    // `elyvel schedule:run` has something to do. The rest publish now.
    const [scheduled, ...live] = posts
    void scheduled

    for (const post of live) {
      post.published = true
      await post.save()
      await commentFactory().count(2).create({ ...COMMENTER, post_id: post.id })
    }
  }
}

export default BlogSeeder
