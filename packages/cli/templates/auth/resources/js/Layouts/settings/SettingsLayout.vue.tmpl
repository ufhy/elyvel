<script setup lang="ts">
import type { BreadcrumbItem } from '@/types'
import { Link, usePage } from '@inertiajs/vue3'
import { computed } from 'vue'
import Heading from '@/components/Heading.vue'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useCurrentUrl } from '@/composables/useCurrentUrl'
import AppLayout from '@/Layouts/AppLayout.vue'

const page = usePage()

// Two-factor is on unless config/auth.ts sets it false (shared as `auth.twoFactor`).
const twoFactorEnabled = computed(
  () => (page.props.auth as { twoFactor?: boolean } | undefined)?.twoFactor !== false,
)

const items = computed(() => [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/password', label: 'Password' },
  ...(twoFactorEnabled.value ? [{ href: '/settings/two-factor', label: 'Two-Factor' }] : []),
  { href: '/settings/appearance', label: 'Appearance' },
])

const { currentUrl, isCurrentOrParentUrl } = useCurrentUrl()

const breadcrumbs = computed<BreadcrumbItem[]>(() => {
  const current = items.value.find(i => i.href === currentUrl.value)
  const crumbs: BreadcrumbItem[] = [{ title: 'Settings', href: '/settings/profile' }]
  if (current && current.href !== '/settings/profile')
    crumbs.push({ title: current.label, href: current.href })
  return crumbs
})
</script>

<template>
  <AppLayout :breadcrumbs="breadcrumbs">
    <div class="px-4 py-6">
      <Heading title="Settings" description="Manage your profile and account settings" />

      <div class="flex flex-col lg:flex-row lg:space-x-12">
        <aside class="w-full max-w-xl lg:w-48">
          <nav class="flex flex-col space-x-0 space-y-1" aria-label="Settings">
            <Button
              v-for="item in items"
              :key="item.href"
              variant="ghost"
              class="w-full justify-start" :class="[{ 'bg-muted': isCurrentOrParentUrl(item.href) }]"
              as-child
            >
              <Link :href="item.href">
                {{ item.label }}
              </Link>
            </Button>
          </nav>
        </aside>

        <Separator class="my-6 lg:hidden" />

        <div class="flex-1 md:max-w-2xl">
          <section class="max-w-xl space-y-12">
            <slot />
          </section>
        </div>
      </div>
    </div>
  </AppLayout>
</template>
