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
      published_at: 'nullable|date',
    }
  }
}

export default UpdatePostRequest
