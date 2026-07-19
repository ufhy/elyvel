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
      // If this app runs as more than one instance, every instance's own
      // `schedule:run`/`schedule:work` would otherwise publish the same due
      // posts redundantly (harmless here since `.save()` is idempotent, but
      // the pattern matters for jobs that aren't, e.g. sending an email).
      // Needs a shared mutex wired via `configureScheduleMutex()` (e.g.
      // `RedisScheduleMutex`) to actually take effect across instances —
      // it's a no-op with the default per-process `MemoryScheduleMutex`.
      .onOneServer()
  }
}

export default ScheduleServiceProvider
