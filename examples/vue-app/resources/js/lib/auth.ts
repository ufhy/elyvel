/**
 * Thin wrappers over the Better Auth JSON API (mounted at /api/auth/*). Same
 * origin, so the session cookie rides along automatically. Each returns
 * `{ error }` on failure or `{ data }` on success.
 */
async function post(path: string, body: Record<string, unknown>): Promise<{ error?: string; data?: unknown }> {
  const res = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { error: (data as { message?: string }).message ?? `Request failed (${res.status})` }
  return { data }
}

export const authApi = {
  signUp: (name: string, email: string, password: string) => post('sign-up/email', { name, email, password }),
  signIn: (email: string, password: string) => post('sign-in/email', { email, password }),
  signOut: () => post('sign-out', {}),
  requestPasswordReset: (email: string, redirectTo: string) => post('request-password-reset', { email, redirectTo }),
  resetPassword: (newPassword: string, token: string) => post('reset-password', { newPassword, token }),
  sendVerification: (email: string, callbackURL: string) => post('send-verification-email', { email, callbackURL }),
  updateUser: (name: string) => post('update-user', { name }),
  changePassword: (currentPassword: string, newPassword: string) =>
    post('change-password', { currentPassword, newPassword }),
}
