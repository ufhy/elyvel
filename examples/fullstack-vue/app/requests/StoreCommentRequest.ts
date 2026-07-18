import type { Rules } from '@elyvel/validation'
import { FormRequest } from '@elyvel/validation'

export class StoreCommentRequest extends FormRequest {
  rules(): Rules {
    return { body: 'required|string|max:2000' }
  }
}

export default StoreCommentRequest
