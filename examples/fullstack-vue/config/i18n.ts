import { defineI18nConfig } from '@elysia-ravel/i18n'

export default defineI18nConfig({
  locale: process.env.APP_LOCALE ?? 'en',
  fallback: 'en',
  path: 'lang',
})
