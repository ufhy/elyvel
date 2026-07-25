<script setup lang="ts">
import type { BreadcrumbItem } from '@/types'
import { ChevronsUpDown } from '@lucide/vue'
import { RouterLink } from 'vue-router'
import AppLogo from '@/components/AppLogo.vue'
import Breadcrumbs from '@/components/Breadcrumbs.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import UserInfo from '@/components/UserInfo.vue'
import UserMenuContent from '@/components/UserMenuContent.vue'
import { useAuth } from '@/composables/useAuth'

withDefaults(defineProps<{ breadcrumbs?: BreadcrumbItem[] }>(), {
  breadcrumbs: () => [],
})

const { user } = useAuth()

const nav = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/settings/profile', label: 'Settings' },
]
</script>

<template>
  <div class="flex min-h-screen w-full flex-col bg-background">
    <header class="border-b border-border">
      <div class="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4">
        <div class="flex items-center gap-6">
          <RouterLink to="/dashboard" class="flex items-center">
            <AppLogo />
          </RouterLink>
          <nav class="flex gap-4">
            <RouterLink
              v-for="item in nav"
              :key="item.href"
              :to="item.href"
              class="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {{ item.label }}
            </RouterLink>
          </nav>
          <Breadcrumbs v-if="breadcrumbs.length" :breadcrumbs="breadcrumbs" />
        </div>
        <div class="flex items-center gap-2">
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger
              class="flex items-center gap-2 rounded-md p-1 outline-none hover:bg-accent"
              data-testid="nav-user"
            >
              <UserInfo v-if="user" :user="user" />
              <ChevronsUpDown class="size-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-56" align="end">
              <UserMenuContent v-if="user" :user="user" />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
    <main class="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4">
      <slot />
    </main>
  </div>
</template>
