<script setup lang="ts">
defineProps<{
  label: string
  type?: string
  modelValue: string
  autocomplete?: string
  placeholder?: string
}>()
defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <label class="block">
    <span class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">{{ label }}</span>
    <input
      :type="type ?? 'text'"
      :value="modelValue"
      :autocomplete="autocomplete"
      :placeholder="placeholder"
      required
      class="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
  </label>
</template>
