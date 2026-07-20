import type { Data, Rules } from '@elyvel/validation'
import { Str } from '@elyvel/support'
import { FormRequest } from '@elyvel/validation'

export class StorePostRequest extends FormRequest {
  /** A user-typed slug like "My Cool Post!" is cleaned up to "my-cool-post" before the kebab-case regex below ever sees it. */
  override prepareForValidation(data: Data): Data {
    if (typeof data.slug === 'string' && data.slug.trim() !== '')
      data.slug = Str.slug(data.slug)
    return data
  }

  rules(): Rules {
    return {
      title: 'required|string|max:255',
      // Leave blank to auto-generate from the title (see PostObserver) —
      // when set, still validated: kebab-case shape + unique.
      slug: 'nullable|string|max:255|regex:^[a-z0-9]+(?:-[a-z0-9]+)*$|unique:posts,slug',
      body: 'required|string',
      // 5MB max; at least 200x200 so a tiny icon can't pass as a cover. `dimensions`
      // also supports `ratio=16/9` etc. if you want to enforce a fixed aspect.
      // Not persisted here — see PostController.storeCoverImage.
      cover_image: 'nullable|file|image|dimensions:min_width=200,min_height=200|max:5120',
      published_at: 'nullable|date',
    }
  }
}

export default StorePostRequest
