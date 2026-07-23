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
  themeConfig: {
    // Shown in the nav bar before the site title.
    logo: '/logo.svg',
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
        text: 'Security',
        items: [
          { text: 'Authentication', link: '/security/authentication' },
        ],
      },
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/ufhy/elyvel' },
    ],
    search: { provider: 'local' },
  },
})
