<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3'
import { computed } from 'vue'

const page = usePage()
const user = computed(() => (page.props as { user?: { name?: string, email?: string } }).user)

const features = [
  { tag: 'orm', title: 'Eloquent ORM', desc: 'Active-record models, relations, migrations — on SQLite, Postgres & MySQL.' },
  { tag: 'auth', title: 'Auth + 2FA', desc: 'Better Auth: email/password, social sign-in, TOTP two-factor.' },
  { tag: 'queue', title: 'Queues & Scheduler', desc: 'Background jobs, queued listeners, cron-style scheduling.' },
  { tag: 'inertia', title: 'Inertia + Vue', desc: 'Server-driven SPA with SSR and Vite HMR out of the box.' },
  { tag: 'validation', title: 'Validation', desc: '90+ rules, form requests, and DB-aware unique/exists.' },
  { tag: 'more', title: 'Batteries included', desc: 'Cache, storage, mail, events, broadcasting, notifications.' },
]
</script>

<template>
  <div class="relative min-h-screen overflow-hidden bg-gray-950 text-gray-100 antialiased">
    <!-- ambient background: indigo glow + faint grid -->
    <div class="pointer-events-none absolute inset-0">
      <div class="absolute -top-40 left-1/2 h-[38rem] w-[38rem] -translate-x-1/2 rounded-full bg-indigo-600/20 blur-[120px]" />
      <div
        class="absolute inset-0 opacity-[0.06]"
        style="background-image: linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px); background-size: 56px 56px; mask-image: radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%);"
      />
    </div>

    <div class="relative mx-auto flex min-h-screen max-w-5xl flex-col px-6">
      <!-- top bar -->
      <header class="flex items-center justify-between py-6">
        <div class="flex items-center gap-2.5">
          <div class="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500 text-sm font-black text-white">
            r
          </div>
          <span class="font-mono text-sm tracking-tight text-gray-300">elysia-ravel</span>
        </div>
        <nav class="flex items-center gap-5 text-sm text-gray-400">
          <a href="https://github.com/ufhy/elysia-ravel" class="transition hover:text-white">GitHub</a>
          <Link v-if="user" href="/dashboard" class="transition hover:text-white">
            Dashboard
          </Link>
          <Link v-else href="/login" class="transition hover:text-white">
            Sign in
          </Link>
        </nav>
      </header>

      <!-- hero -->
      <main class="flex flex-1 flex-col justify-center py-16">
        <span class="mb-5 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-xs text-indigo-300">
          <span class="h-1.5 w-1.5 rounded-full bg-indigo-400" />
          Laravel-grade DX · on Bun + Elysia
        </span>

        <h1 class="max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-6xl md:text-7xl">
          Build fast.
          <span class="bg-gradient-to-r from-indigo-300 to-indigo-500 bg-clip-text text-transparent">Ship full-stack.</span>
        </h1>
        <p class="mt-6 max-w-xl text-lg leading-relaxed text-gray-400">
          A batteries-included framework for the Bun runtime — the ergonomics you know from
          Laravel, the speed of Elysia, and a Vue front-end wired in.
        </p>

        <div class="mt-9 flex flex-wrap items-center gap-3">
          <Link
            v-if="user"
            href="/dashboard"
            class="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400"
          >
            Go to dashboard →
          </Link>
          <template v-else>
            <Link
              href="/register"
              class="rounded-lg bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-400"
            >
              Get started →
            </Link>
            <Link
              href="/login"
              class="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-semibold text-gray-200 transition hover:bg-white/5"
            >
              Sign in
            </Link>
          </template>
          <span v-if="user" class="font-mono text-sm text-gray-500">signed in as {{ user.email }}</span>
        </div>

        <!-- feature grid -->
        <div class="mt-16 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="f in features"
            :key="f.tag"
            class="group bg-gray-950 p-5 transition hover:bg-gray-900"
          >
            <div class="font-mono text-xs text-indigo-400">
              {{ f.tag }}
            </div>
            <div class="mt-2 font-medium text-white">
              {{ f.title }}
            </div>
            <p class="mt-1 text-sm leading-relaxed text-gray-400">
              {{ f.desc }}
            </p>
          </div>
        </div>
      </main>

      <footer class="border-t border-white/5 py-6 font-mono text-xs text-gray-600">
        elysia-ravel · {{ new Date().getFullYear() }}
      </footer>
    </div>
  </div>
</template>
