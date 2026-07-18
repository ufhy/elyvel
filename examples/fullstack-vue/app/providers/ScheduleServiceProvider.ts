import type { Schedule } from '@elyvel/scheduler'
import { now } from '@elyvel/core'
import { ScheduleServiceProvider as BaseScheduleServiceProvider } from '@elyvel/scheduler'
import { Post } from '../models/Post'

/** App scheduled tasks (Laravel's console `Kernel::schedule`). */
export class ScheduleServiceProvider extends BaseScheduleServiceProvider {
  protected override schedule(schedule: Schedule): void {
    schedule
      .call(async () => {
        const due = await Post.query()
          .where('published', false)
          .whereNotNull('published_at')
          .where('published_at', '<=', now().toISOString())
          .get()
        for (const post of due) {
          post.published = true
          await post.save()
        }
      })
      .named('blog:publish-scheduled-posts')
      .everyMinute()
  }
}

export default ScheduleServiceProvider
