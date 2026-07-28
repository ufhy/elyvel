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
            ],
          },
          {
            text: 'The Basics',
            items: [
              { text: 'Routing', link: '/basics/routing' },
              { text: 'Middleware', link: '/basics/middleware' },
              { text: 'Controllers', link: '/basics/controllers' },
              { text: 'Validation', link: '/basics/validation' },
            ],
          },
          {
            text: 'Database',
            items: [
              { text: 'Migrations', link: '/database/migrations' },
              { text: 'Eloquent: Getting Started', link: '/database/eloquent' },
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
            ],
          },
          {
            text: 'Security',
            items: [
              { text: 'Authentication', link: '/security/authentication' },
              { text: 'Authorization', link: '/security/authorization' },
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
            ],
          },
          {
            text: 'Dasar',
            items: [
              { text: 'Routing', link: '/id/basics/routing' },
              { text: 'Middleware', link: '/id/basics/middleware' },
              { text: 'Controller', link: '/id/basics/controllers' },
              { text: 'Validasi', link: '/id/basics/validation' },
            ],
          },
          {
            text: 'Database',
            items: [
              { text: 'Migrasi', link: '/id/database/migrations' },
              { text: 'Eloquent: Memulai', link: '/id/database/eloquent' },
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
            ],
          },
          {
            text: 'Keamanan',
            items: [
              { text: 'Autentikasi', link: '/id/security/authentication' },
              { text: 'Otorisasi', link: '/id/security/authorization' },
            ],
          },
        ],
      },
    },
  },
})
