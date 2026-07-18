<script setup lang="ts">
import type { BreadcrumbItem } from '@/types'
import { Link, usePage } from '@inertiajs/vue3'
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import AppLayout from '@/Layouts/AppLayout.vue'

interface PostSummary {
  id: number
  title: string
  author_name: string
  published_at: string | null
  is_mine?: boolean
}

const props = defineProps<{
  posts: {
    data: PostSummary[]
    meta: { total: number, perPage: number, currentPage: number, lastPage: number }
  }
}>()

const page = usePage()
const user = computed(() => (page.props as { user?: { name?: string } }).user)
const breadcrumbs: BreadcrumbItem[] = [{ title: 'Blog', href: '/blog' }]

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
}
</script>

<template>
  <AppLayout :breadcrumbs="breadcrumbs">
    <div class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-semibold text-foreground">
          Blog
        </h1>
        <Link v-if="user" href="/blog/create">
          <Button size="sm">
            New post
          </Button>
        </Link>
      </div>

      <p v-if="props.posts.data.length === 0" class="text-sm text-muted-foreground">
        No posts yet.
      </p>

      <Card v-for="post in props.posts.data" :key="post.id" class="transition hover:border-foreground/20">
        <CardHeader>
          <CardTitle>
            <Link :href="`/blog/${post.id}`" class="hover:underline">
              {{ post.title }}
            </Link>
            <Badge v-if="post.is_mine" variant="secondary" class="ml-2 align-middle">
              yours
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent class="text-sm text-muted-foreground">
          {{ post.author_name }} · {{ formatDate(post.published_at) }}
        </CardContent>
      </Card>

      <div v-if="props.posts.meta.lastPage > 1" class="mt-2 flex items-center justify-center gap-2">
        <Link
          v-for="p in props.posts.meta.lastPage"
          :key="p"
          :href="`/blog?page=${p}`"
          preserve-scroll
        >
          <Button :variant="p === props.posts.meta.currentPage ? 'default' : 'outline'" size="sm">
            {{ p }}
          </Button>
        </Link>
      </div>
    </div>
  </AppLayout>
</template>
