import { defineConfig } from 'vitepress'

// Project page → served under ufhy.github.io/elyvel/, so `base` must be the
// repo name. Change to '/' for a user page or a custom domain.
export default defineConfig({
  title: 'elyvel',
  description: 'A Laravel-inspired, Elysia-first framework for Bun',
  base: '/elyvel/',
  cleanUrls: true,
  lastUpdated: true,
  // Favicon — the elyvel "aperture-e" mark (head hrefs need the base prefix).
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/elyvel/logo.svg' }],
  ],
  // Shared across every locale.
  themeConfig: {
    logo: '/logo.svg',
    socialLinks: [
      { icon: 'github', link: 'https://github.com/ufhy/elyvel' },
    ],
    search: { provider: 'local' },
  },
  // English is the default (root); Bahasa Indonesia lives under /id/. The navbar
  // language switcher is generated automatically; browser-language detection is
  // handled client-side in .vitepress/theme (VitePress does no auto-redirect).
  locales: {
    root: {
      label: 'English',
      lang: 'en',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/guide/installation' },
          { text: 'Authentication', link: '/security/authentication' },
        ],
        sidebar: [
          {
            text: 'Getting Started',
            items: [
              { text: 'Installation', link: '/guide/installation' },
              { text: 'Directory Structure', link: '/guide/directory-structure' },
              { text: 'Configuration', link: '/guide/configuration' },
              { text: 'CLI Reference', link: '/guide/cli-reference' },
            ],
          },
          {
            text: 'The Basics',
            items: [
              { text: 'Routing', link: '/basics/routing' },
              { text: 'Middleware', link: '/basics/middleware' },
              { text: 'Controllers', link: '/basics/controllers' },
              { text: 'Validation', link: '/basics/validation' },
              { text: 'Error Handling', link: '/basics/error-handling' },
              { text: 'Inertia & Vue', link: '/basics/inertia' },
              { text: 'Standalone SPA', link: '/basics/spa' },
            ],
          },
          {
            text: 'Database',
            items: [
              { text: 'Migrations', link: '/database/migrations' },
              { text: 'Eloquent: Getting Started', link: '/database/eloquent' },
              { text: 'Seeding', link: '/database/seeding' },
              { text: 'API Resources', link: '/database/api-resources' },
            ],
          },
          {
            text: 'Digging Deeper',
            items: [
              { text: 'HTTP Session', link: '/digging-deeper/session' },
              { text: 'Cache', link: '/digging-deeper/cache' },
              { text: 'Queues', link: '/digging-deeper/queues' },
              { text: 'Events', link: '/digging-deeper/events' },
              { text: 'Mail', link: '/digging-deeper/mail' },
              { text: 'Notifications', link: '/digging-deeper/notifications' },
              { text: 'Broadcasting', link: '/digging-deeper/broadcasting' },
              { text: 'Service Container', link: '/digging-deeper/container' },
              { text: 'Logging', link: '/digging-deeper/logging' },
              { text: 'Rate Limiting', link: '/digging-deeper/rate-limiting' },
              { text: 'Task Scheduling', link: '/digging-deeper/scheduler' },
              { text: 'Localization', link: '/digging-deeper/localization' },
              { text: 'Views', link: '/digging-deeper/views' },
              { text: 'HTTP Tests', link: '/digging-deeper/testing' },
              { text: 'File Storage', link: '/digging-deeper/storage' },
              { text: 'Helpers & Collections', link: '/digging-deeper/helpers' },
              { text: 'HTTP Client', link: '/digging-deeper/http-client' },
              { text: 'CORS', link: '/digging-deeper/cors' },
              { text: 'Static Files', link: '/digging-deeper/static-files' },
              { text: 'OpenAPI Docs', link: '/digging-deeper/openapi' },
              { text: 'Maintenance Mode', link: '/digging-deeper/maintenance-mode' },
              { text: 'Dates & Timezones', link: '/digging-deeper/dates-and-timezones' },
            ],
          },
          {
            text: 'Security',
            items: [
              { text: 'Authentication', link: '/security/authentication' },
              { text: 'Authorization', link: '/security/authorization' },
            ],
          },
          // First-party packages you install alongside the framework, rather
          // than framework features — the same split Laravel's sidebar makes.
          {
            text: 'Packages',
            items: [
              { text: 'Writing a Driver', link: '/packages/writing-drivers' },
              { text: 'Log Viewer', link: '/packages/log-viewer' },
              { text: 'Telegram', link: '/packages/telegram' },
            ],
          },
        ],
      },
    },
    id: {
      label: 'Bahasa Indonesia',
      lang: 'id',
      // Must be the locale ROOT — the language switcher uses it as the base to
      // map the current page into this locale. A deep path here mangles every
      // switch target (e.g. .../id/guide/installation/guide/configuration).
      link: '/id/',
      description: 'Framework untuk Bun yang terinspirasi Laravel, dibangun di atas Elysia',
      themeConfig: {
        nav: [
          { text: 'Panduan', link: '/id/guide/installation' },
          { text: 'Autentikasi', link: '/id/security/authentication' },
        ],
        sidebar: [
          {
            text: 'Memulai',
            items: [
              { text: 'Instalasi', link: '/id/guide/installation' },
              { text: 'Struktur Direktori', link: '/id/guide/directory-structure' },
              { text: 'Konfigurasi', link: '/id/guide/configuration' },
              { text: 'Referensi CLI', link: '/id/guide/cli-reference' },
            ],
          },
          {
            text: 'Dasar',
            items: [
              { text: 'Routing', link: '/id/basics/routing' },
              { text: 'Middleware', link: '/id/basics/middleware' },
              { text: 'Controller', link: '/id/basics/controllers' },
              { text: 'Validasi', link: '/id/basics/validation' },
              { text: 'Penanganan Error', link: '/id/basics/error-handling' },
              { text: 'Inertia & Vue', link: '/id/basics/inertia' },
              { text: 'SPA Standalone', link: '/id/basics/spa' },
            ],
          },
          {
            text: 'Database',
            items: [
              { text: 'Migrasi', link: '/id/database/migrations' },
              { text: 'Eloquent: Memulai', link: '/id/database/eloquent' },
              { text: 'Seeding', link: '/id/database/seeding' },
              { text: 'API Resource', link: '/id/database/api-resources' },
            ],
          },
          {
            text: 'Pendalaman',
            items: [
              { text: 'HTTP Session', link: '/id/digging-deeper/session' },
              { text: 'Cache', link: '/id/digging-deeper/cache' },
              { text: 'Queue', link: '/id/digging-deeper/queues' },
              { text: 'Event', link: '/id/digging-deeper/events' },
              { text: 'Mail', link: '/id/digging-deeper/mail' },
              { text: 'Notifikasi', link: '/id/digging-deeper/notifications' },
              { text: 'Broadcasting', link: '/id/digging-deeper/broadcasting' },
              { text: 'Service Container', link: '/id/digging-deeper/container' },
              { text: 'Logging', link: '/id/digging-deeper/logging' },
              { text: 'Rate Limiting', link: '/id/digging-deeper/rate-limiting' },
              { text: 'Task Scheduling', link: '/id/digging-deeper/scheduler' },
              { text: 'Localization', link: '/id/digging-deeper/localization' },
              { text: 'View', link: '/id/digging-deeper/views' },
              { text: 'HTTP Test', link: '/id/digging-deeper/testing' },
              { text: 'File Storage', link: '/id/digging-deeper/storage' },
              { text: 'Helper & Collection', link: '/id/digging-deeper/helpers' },
              { text: 'HTTP Client', link: '/id/digging-deeper/http-client' },
              { text: 'CORS', link: '/id/digging-deeper/cors' },
              { text: 'Static Files', link: '/id/digging-deeper/static-files' },
              { text: 'Dokumentasi OpenAPI', link: '/id/digging-deeper/openapi' },
              { text: 'Maintenance Mode', link: '/id/digging-deeper/maintenance-mode' },
              { text: 'Tanggal & Timezone', link: '/id/digging-deeper/dates-and-timezones' },
            ],
          },
          {
            text: 'Keamanan',
            items: [
              { text: 'Autentikasi', link: '/id/security/authentication' },
              { text: 'Otorisasi', link: '/id/security/authorization' },
            ],
          },
          {
            text: 'Packages',
            items: [
              { text: 'Menulis Driver', link: '/id/packages/writing-drivers' },
              { text: 'Log Viewer', link: '/id/packages/log-viewer' },
              { text: 'Telegram', link: '/id/packages/telegram' },
            ],
          },
        ],
      },
    },
  },
})
