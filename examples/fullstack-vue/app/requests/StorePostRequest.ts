import type { Rules } from '@elyvel/validation'
import { FormRequest } from '@elyvel/validation'

export class StorePostRequest extends FormRequest {
  rules(): Rules {
    return {
      title: 'required|string|max:255',
      slug: 'required|string|max:255|regex:^[a-z0-9]+(?:-[a-z0-9]+)*$',
      body: 'required|string',
      published_at: 'nullable|date',
    }
  }
}

export default StorePostRequest
