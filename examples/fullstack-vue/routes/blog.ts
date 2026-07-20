import { apiResource, resource } from '@elyvel/core'
import { CommentController } from '../app/controllers/CommentController'
import { PostController } from '../app/controllers/PostController'
import { Comment } from '../app/models/Comment'
import { Post } from '../app/models/Post'

/**
 * The blog: a full 7-action `resource()` for posts (index/show are public;
 * create/store/edit/update/destroy require auth — enforced again per-post by
 * PostPolicy via `ctx.authorize(...)` in the controller). Comments are a
 * nested `apiResource` — JSON-only, always behind auth, also route-model-bound
 * (`bind: Comment`) so `destroy` authorizes via CommentPolicy + `ctx.model`
 * the same way PostController does, instead of an inline ownership check.
 */
export default resource('/blog', PostController, {
  bind: Post,
  // Same param name ("post") as the nested comments resource below — Elysia's
  // router can't have two differently-named dynamic segments at the same
  // depth (`/blog/:id` vs `/blog/:post` would collide).
  param: 'post',
  middleware: {
    create: ['auth'],
    store: ['auth', 'csrf'],
    edit: ['auth'],
    update: ['auth', 'csrf'],
    destroy: ['auth', 'csrf'],
  },
}).use(
  // Relative to the parent's own `/blog` prefix — NOT `/blog/:post/comments`,
  // which would double up to `/blog/blog/:post/comments`.
  apiResource('/:post/comments', CommentController, {
    only: ['store', 'destroy'],
    bind: Comment,
    middleware: ['auth', 'csrf'],
  }),
)
