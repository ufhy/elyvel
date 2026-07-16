<script setup lang="ts">
import type { User } from '@/types'
import { Link, router } from '@inertiajs/vue3'
import { LogOut, Settings } from '@lucide/vue'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import UserInfo from '@/components/UserInfo.vue'
import { authApi } from '@/lib/auth'

defineProps<{ user: User }>()

async function logout() {
  await authApi.signOut()
  router.visit('/login')
}
</script>

<template>
  <DropdownMenuLabel class="p-0 font-normal">
    <div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
      <UserInfo :user="user" :show-email="true" />
    </div>
  </DropdownMenuLabel>
  <DropdownMenuSeparator />
  <DropdownMenuGroup>
    <DropdownMenuItem :as-child="true">
      <Link class="block w-full cursor-pointer" href="/settings/profile">
        <Settings class="mr-2 h-4 w-4" />
        Settings
      </Link>
    </DropdownMenuItem>
  </DropdownMenuGroup>
  <DropdownMenuSeparator />
  <DropdownMenuItem :as-child="true" data-testid="logout" @click="logout">
    <button class="block w-full cursor-pointer text-left" type="button">
      <LogOut class="mr-2 h-4 w-4" />
      Log out
    </button>
  </DropdownMenuItem>
</template>
