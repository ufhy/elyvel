import type { User } from '@elyvel/auth'
import type { MiddlewareContext } from '@elyvel/core'
import { cache } from '@elyvel/cache'
import { Controller, redirect, Resource } from '@elyvel/core'
import { Inertia } from '@elyvel/inertia'
import { storage } from '@elyvel/storage'
import { trans } from '@elyvel/support'
import { Post } from '../models/Post'
import { StorePostRequest } from '../requests/StorePostRequest'
import { UpdatePostRequest } from '../requests/UpdatePostRequest'
import { postResource } from '../resources/PostResource'

const PER_PAGE = 6

/**
 * The blog's public pages, plus authoring for signed-in users. Wired as a full
 * 7-action `resource()` (not `apiResource`) — `create`/`edit` render Inertia
 * forms. Route-model-binding (`bind: Post`) resolves `:id` before every
 * handler here runs, so `ctx.model` is always a loaded Post (or the request
 * already 404'd).
 */
/** `ctx.authorize` is derived at runtime (typed `unknown` on MiddlewareContext) — cast once here. */
function authorize(ctx: MiddlewareContext, ability: string, ...args: unknown[]): void {
  (ctx.authorize as (a: string, ...x: unknown[]) => void)(ability, ...args)
}

/**
 * `cover_image` isn't in either FormRequest's `rules()` output (validated()
 * only returns ruled fields), so it's read straight off the raw multipart
 * body — Elysia parses a `multipart/form-data` request into `ctx.body` with
 * file fields as `File` instances, no schema needed.
 */
async function storeCoverImage(ctx: MiddlewareContext): Promise<string | undefined> {
  const file = (ctx.body as Record<string, unknown>).cover_image
  if (!(file instanceof File) || file.size === 0)
    return undefined
  return storage().putFile('covers', file)
}

export class PostController extends Controller {
  /** GET /blog — published posts only, paginated and cached. */
  async index(ctx: MiddlewareContext) {
    const page = Math.max(1, Number(ctx.query.page ?? '1') || 1)
    const user = ctx.user as User | null
    // Tagged so create/update/destroy can invalidate just this listing cache
    // without flushing the whole cache (which might hold unrelated entries).
    const paginator = await cache().tags(['posts']).remember(`blog:posts:${page}`, 60, () =>
      Post.query().where('published', true).orderBy('published_at', 'desc').paginate(PER_PAGE, page))
    const posts = Resource.paginated(paginator, p => postResource(p, user?.id))
    return Inertia.render('Blog/Index', { posts, user })
  }

  /** GET /blog/create — any signed-in user may author a post. */
  async create(ctx: MiddlewareContext) {
    authorize(ctx, 'create', Post)
    return Inertia.render('Blog/Create')
  }

  /** POST /blog */
  async store(ctx: MiddlewareContext) {
    authorize(ctx, 'create', Post)
    const validated = await StorePostRequest.validate(ctx)
    const coverImage = await storeCoverImage(ctx)
    const user = ctx.user as User
    const post = await Post.create({
      ...validated,
      ...(coverImage ? { cover_image: coverImage } : {}),
      user_id: user.id,
      author_name: user.name,
      author_email: user.email,
    })
    await cache().tags(['posts']).flush()
    return redirect(`/blog/${post.id}`)
  }

  /** GET /blog/:id — 404s an unpublished post to anyone but its author. */
  async show(ctx: MiddlewareContext) {
    const post = ctx.model as Post
    const user = ctx.user as User | null
    if (!post.published && user?.id !== post.user_id) {
      return ctx.status(404, { message: trans('errors.not_found', { resource: 'post' }, 'Post not found') })
    }
    await post.load('comments')
    return Inertia.render('Blog/Show', { post: postResource(post, user?.id), user })
  }

  /** GET /blog/:id/edit */
  async edit(ctx: MiddlewareContext) {
    const post = ctx.model as Post
    authorize(ctx, 'update', post)
    return Inertia.render('Blog/Edit', { post: postResource(post) })
  }

  /** PUT|PATCH /blog/:id */
  async update(ctx: MiddlewareContext) {
    const post = ctx.model as Post
    authorize(ctx, 'update', post)
    const validated = await UpdatePostRequest.validate(ctx)
    const coverImage = await storeCoverImage(ctx)
    const previousCoverImage = post.cover_image
    await post.update({ ...validated, ...(coverImage ? { cover_image: coverImage } : {}) })
    if (coverImage && previousCoverImage)
      await storage().delete(previousCoverImage)
    await cache().tags(['posts']).flush()
    return redirect(`/blog/${post.id}`)
  }

  /** DELETE /blog/:id — soft delete. */
  async destroy(ctx: MiddlewareContext) {
    const post = ctx.model as Post
    authorize(ctx, 'delete', post)
    await post.delete()
    await cache().tags(['posts']).flush()
    return redirect('/blog')
  }
}

export default PostController
