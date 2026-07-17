<script setup lang="ts">
import type { User } from '@/types'
import { LogOut, Settings } from '@lucide/vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import UserInfo from '@/components/UserInfo.vue'
import { useAuth } from '@/composables/useAuth'

defineProps<{ user: User }>()

const router = useRouter()
const { signOut } = useAuth()

async function logout() {
  await signOut()
  router.push('/login')
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
      <RouterLink class="block w-full cursor-pointer" to="/settings/profile">
        <Settings class="mr-2 h-4 w-4" />
        Settings
      </RouterLink>
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
