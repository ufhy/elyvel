<script setup lang="ts">
defineProps<{ message: string }>()
</script>

<template>
  <main style="max-width: 32rem; margin: 3rem auto; font-family: sans-serif">
    <h1>Inertia + Vue</h1>
    <p data-testid="message">{{ message }}</p>
    <p>Rendered by Vue on the client, driven by an elysia-ravel controller.</p>
  </main>
</template>
