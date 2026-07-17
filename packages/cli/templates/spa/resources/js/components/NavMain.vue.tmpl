<script setup lang="ts">
import type { NavItem } from '@/types'
import { RouterLink } from 'vue-router'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { useCurrentUrl } from '@/composables/useCurrentUrl'

defineProps<{
  items: NavItem[]
}>()

const { isCurrentUrl } = useCurrentUrl()
</script>

<template>
  <SidebarGroup class="px-2 py-0">
    <SidebarGroupLabel>Platform</SidebarGroupLabel>
    <SidebarMenu>
      <SidebarMenuItem v-for="item in items" :key="item.title">
        <SidebarMenuButton
          as-child
          :is-active="isCurrentUrl(item.href)"
          :tooltip="item.title"
        >
          <RouterLink :to="item.href">
            <component :is="item.icon" />
            <span>{{ item.title }}</span>
          </RouterLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  </SidebarGroup>
</template>
