import type { RequestLike, Rules } from '@elyvel/validation'
import type { Post } from '../models/Post'
import { FormRequest } from '@elyvel/validation'

export class UpdatePostRequest extends FormRequest {
  rules(ctx: RequestLike): Rules {
    const post = ctx.model as Post
    return {
      title: 'required|string|max:255',
      slug: `required|string|max:255|regex:^[a-z0-9]+(?:-[a-z0-9]+)*$|unique:posts,slug,${post.id}`,
      body: 'required|string',
      // 5MB max; at least 200x200 so a tiny icon can't pass as a cover. `dimensions`
      // also supports `ratio=16/9` etc. if you want to enforce a fixed aspect.
      // Not persisted here — see PostController.storeCoverImage.
      cover_image: 'nullable|file|image|dimensions:min_width=200,min_height=200|max:5120',
      published_at: 'nullable|date',
    }
  }
}

export default UpdatePostRequest
