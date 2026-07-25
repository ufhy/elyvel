/**
 * Thin wrappers over the Better Auth JSON API (mounted at /api/auth/*). Same
 * origin, so the session cookie rides along automatically. Each returns
 * `{ error }` on failure or `{ data }` on success.
 */
async function post(path: string, body: Record<string, unknown>): Promise<{ error?: string, data?: unknown }> {
  const res = await fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok)
    return { error: (data as { message?: string }).message ?? `Request failed (${res.status})` }
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

  // ── social sign-in (opt-in; providers configured server-side) ──────────────
  // Returns { url } — the OAuth page to redirect the browser to.
  signInSocial: (provider: string, callbackURL = '/dashboard') =>
    post('sign-in/social', { provider, callbackURL }),

  // ── two-factor (TOTP) ──────────────────────────────────────────────────────
  // enable → { totpURI, backupCodes }; scan the URI, then confirm with verifyTotp.
  enableTwoFactor: (password: string) => post('two-factor/enable', { password }),
  disableTwoFactor: (password: string) => post('two-factor/disable', { password }),
  // Used both to finish enrollment and to clear the sign-in 2FA challenge.
  verifyTotp: (code: string, trustDevice = false) =>
    post('two-factor/verify-totp', { code, trustDevice }),
  verifyBackupCode: (code: string) => post('two-factor/verify-backup-code', { code }),
  generateBackupCodes: (password: string) =>
    post('two-factor/generate-backup-codes', { password }),
}
