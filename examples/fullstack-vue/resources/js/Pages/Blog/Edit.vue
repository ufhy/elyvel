<script setup lang="ts">
import type { BreadcrumbItem } from '@/types'
import { useForm } from '@inertiajs/vue3'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AppLayout from '@/Layouts/AppLayout.vue'

const props = defineProps<{
  post: { id: number, title: string, slug: string, body: string, published_at: string | null }
}>()

const breadcrumbs: BreadcrumbItem[] = [
  { title: 'Blog', href: '/blog' },
  { title: props.post.title, href: `/blog/${props.post.id}` },
  { title: 'Edit', href: `/blog/${props.post.id}/edit` },
]

// datetime-local inputs need "YYYY-MM-DDTHH:mm", not a full ISO string.
const form = useForm({
  title: props.post.title,
  slug: props.post.slug,
  body: props.post.body,
  published_at: props.post.published_at?.slice(0, 16) ?? '',
})

function submit() {
  form.put(`/blog/${props.post.id}`)
}
</script>

<template>
  <AppLayout :breadcrumbs="breadcrumbs">
    <div class="mx-auto w-full max-w-xl p-4">
      <h1 class="text-lg font-semibold text-foreground">
        Edit post
      </h1>
      <form class="mt-6 space-y-4" @submit.prevent="submit">
        <div class="grid gap-2">
          <Label for="title">Title</Label>
          <Input id="title" v-model="form.title" required />
          <p v-if="form.errors.title" class="text-sm text-destructive">
            {{ form.errors.title }}
          </p>
        </div>
        <div class="grid gap-2">
          <Label for="slug">Slug</Label>
          <Input id="slug" v-model="form.slug" required />
          <p v-if="form.errors.slug" class="text-sm text-destructive">
            {{ form.errors.slug }}
          </p>
        </div>
        <div class="grid gap-2">
          <Label for="body">Body</Label>
          <textarea
            id="body"
            v-model="form.body"
            rows="8"
            required
            class="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p v-if="form.errors.body" class="text-sm text-destructive">
            {{ form.errors.body }}
          </p>
        </div>
        <div class="grid gap-2">
          <Label for="published_at">Publish at (optional — leave blank to save as a draft)</Label>
          <Input id="published_at" v-model="form.published_at" type="datetime-local" />
          <p v-if="form.errors.published_at" class="text-sm text-destructive">
            {{ form.errors.published_at }}
          </p>
        </div>
        <Button type="submit" :disabled="form.processing">
          {{ form.processing ? 'Saving…' : 'Save' }}
        </Button>
      </form>
    </div>
  </AppLayout>
</template>
