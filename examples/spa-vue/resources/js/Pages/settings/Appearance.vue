<script setup lang="ts">
import AppearanceTabs from '@/components/AppearanceTabs.vue'
import SettingsLayout from '@/Layouts/settings/SettingsLayout.vue'
</script>

<template>
  <SettingsLayout>
    <div class="max-w-lg">
      <h2 class="text-lg font-semibold text-foreground">
        Appearance
      </h2>
      <p class="mt-1 text-sm text-muted-foreground">
        Update how the app looks on your device.
      </p>
      <div class="mt-6">
        <AppearanceTabs />
      </div>
    </div>
  </SettingsLayout>
</template>
