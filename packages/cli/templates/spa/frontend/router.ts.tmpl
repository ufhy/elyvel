import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '@/composables/useAuth'

/**
 * Client-side routes (no Inertia). Each view is code-split. `meta.auth` requires
 * a signed-in user; `meta.guest` bounces signed-in users to the dashboard. The
 * server also guards the JSON API — the client guard is only for UX.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('@/Pages/Welcome.vue') },
    { path: '/login', name: 'login', component: () => import('@/Pages/auth/Login.vue'), meta: { guest: true } },
    { path: '/register', name: 'register', component: () => import('@/Pages/auth/Register.vue'), meta: { guest: true } },
    { path: '/forgot-password', name: 'forgot-password', component: () => import('@/Pages/auth/ForgotPassword.vue'), meta: { guest: true } },
    { path: '/reset-password', name: 'reset-password', component: () => import('@/Pages/auth/ResetPassword.vue'), meta: { guest: true } },
    { path: '/two-factor', name: 'two-factor', component: () => import('@/Pages/auth/TwoFactorChallenge.vue') },
    { path: '/verify-email', name: 'verify-email', component: () => import('@/Pages/auth/VerifyEmail.vue'), meta: { auth: true } },
    { path: '/dashboard', name: 'dashboard', component: () => import('@/Pages/Dashboard.vue'), meta: { auth: true } },
    { path: '/settings/profile', name: 'settings.profile', component: () => import('@/Pages/settings/Profile.vue'), meta: { auth: true } },
    { path: '/settings/password', name: 'settings.password', component: () => import('@/Pages/settings/Password.vue'), meta: { auth: true } },
    { path: '/settings/appearance', name: 'settings.appearance', component: () => import('@/Pages/settings/Appearance.vue'), meta: { auth: true } },
    { path: '/settings/two-factor', name: 'settings.two-factor', component: () => import('@/Pages/settings/TwoFactor.vue'), meta: { auth: true } },
  ],
})

router.beforeEach(async (to) => {
  const { user, load } = useAuth()
  await load()
  if (to.meta.auth && !user.value)
    return { name: 'login' }
  if (to.meta.guest && user.value)
    return { name: 'dashboard' }
  return true
})
