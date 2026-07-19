<script setup lang="ts">
import type { BreadcrumbItem } from '@/types'
import { Link, router, usePage } from '@inertiajs/vue3'
import { onMounted, onUnmounted, ref } from 'vue'
import { Button } from '@/components/ui/button'
import AppLayout from '@/Layouts/AppLayout.vue'

interface CommentItem {
  id: number
  author_name: string
  body: string
  created_at: string
  is_mine?: boolean
}

interface PostDetail {
  id: number
  title: string
  body: string
  cover_image_url: string | null
  author_name: string
  published: boolean
  published_at: string | null
  is_mine?: boolean
  comments?: CommentItem[]
}

const props = defineProps<{ post: PostDetail }>()

/**
 * Live comments: `CommentBroadcast` (see app/broadcasts) publishes to
 * `posts.{id}` whenever anyone posts a comment. No client helper exists in
 * the framework yet (no Echo equivalent), so this is a plain WebSocket —
 * matching the wire protocol `BroadcastHub` speaks (`packages/broadcasting`).
 */
let socket: WebSocket | undefined
onMounted(() => {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/`
  socket = new WebSocket(url)
  socket.addEventListener('open', () => {
    socket?.send(JSON.stringify({ event: 'subscribe', channel: `posts.${props.post.id}` }))
  })
  socket.addEventListener('message', (raw) => {
    const msg = JSON.parse(raw.data as string) as { channel?: string, event?: string }
    if (msg.channel === `posts.${props.post.id}` && msg.event === 'CommentBroadcast')
      router.reload({ only: ['post'] })
  })
})
onUnmounted(() => socket?.close())

const page = usePage()
const user = () => (page.props as { user?: { name?: string } }).user

const commentBody = ref('')
const commentError = ref('')
const submittingComment = ref(false)

/** Reads the readable `XSRF-TOKEN` cookie the session plugin sets (Laravel-style double-submit). */
function xsrfToken(): string {
  return decodeURIComponent(document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/)?.[1] ?? '')
}

/**
 * CommentController is a JSON-only `apiResource` (no Inertia render), so it's
 * called with a plain `fetch` rather than `router.post` — then the page's
 * `post` prop is reloaded to pick up the new comment.
 */
async function submitComment() {
  commentError.value = ''
  submittingComment.value = true
  try {
    const res = await fetch(`/blog/${props.post.id}/comments`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-xsrf-token': xsrfToken() },
      body: JSON.stringify({ body: commentBody.value }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      commentError.value = data.message ?? 'Could not post your comment.'
      return
    }
    commentBody.value = ''
    router.reload({ only: ['post'] })
  }
  finally {
    submittingComment.value = false
  }
}

async function deleteComment(id: number) {
  const res = await fetch(`/blog/${props.post.id}/comments/${id}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'x-xsrf-token': xsrfToken() },
  })
  if (res.ok)
    router.reload({ only: ['post'] })
}

function destroyPost() {
  router.delete(`/blog/${props.post.id}`)
}

const breadcrumbs: BreadcrumbItem[] = [
  { title: 'Blog', href: '/blog' },
  { title: props.post.title, href: `/blog/${props.post.id}` },
]
</script>

<template>
  <AppLayout :breadcrumbs="breadcrumbs">
    <div class="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
      <article>
        <div class="flex items-start justify-between gap-4">
          <h1 class="text-2xl font-semibold text-foreground">
            {{ post.title }}
          </h1>
          <div v-if="post.is_mine" class="flex shrink-0 gap-2">
            <Link :href="`/blog/${post.id}/edit`">
              <Button variant="outline" size="sm">
                Edit
              </Button>
            </Link>
            <Button variant="destructive" size="sm" @click="destroyPost">
              Delete
            </Button>
          </div>
        </div>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ post.author_name }}
          <span v-if="!post.published"> · scheduled, not published yet</span>
        </p>
        <img
          v-if="post.cover_image_url"
          :src="post.cover_image_url"
          alt=""
          class="mt-4 max-h-96 w-full rounded-lg object-cover"
        >
        <div class="mt-4 whitespace-pre-line text-sm leading-relaxed text-foreground">
          {{ post.body }}
        </div>
      </article>

      <section class="border-t border-border pt-6">
        <h2 class="text-sm font-semibold text-foreground">
          Comments
        </h2>

        <p v-if="!post.comments?.length" class="mt-3 text-sm text-muted-foreground">
          No comments yet.
        </p>
        <ul v-else class="mt-3 space-y-3">
          <li v-for="comment in post.comments" :key="comment.id" class="rounded-lg border border-border p-3 text-sm">
            <div class="flex items-center justify-between">
              <span class="font-medium text-foreground">{{ comment.author_name }}</span>
              <Button
                v-if="comment.is_mine"
                variant="ghost"
                size="sm"
                class="h-auto p-0 text-xs text-muted-foreground hover:text-destructive"
                @click="deleteComment(comment.id)"
              >
                Remove
              </Button>
            </div>
            <p class="mt-1 text-muted-foreground">
              {{ comment.body }}
            </p>
          </li>
        </ul>

        <form v-if="user()" class="mt-4 space-y-2" @submit.prevent="submitComment">
          <textarea
            v-model="commentBody"
            rows="3"
            required
            placeholder="Add a comment…"
            class="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p v-if="commentError" class="text-sm text-destructive">
            {{ commentError }}
          </p>
          <Button type="submit" size="sm" :disabled="submittingComment">
            {{ submittingComment ? 'Posting…' : 'Post comment' }}
          </Button>
        </form>
        <p v-else class="mt-4 text-sm text-muted-foreground">
          <Link href="/login" class="underline">
            Sign in
          </Link> to comment.
        </p>
      </section>
    </div>
  </AppLayout>
</template>
