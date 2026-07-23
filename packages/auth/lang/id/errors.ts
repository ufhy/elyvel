/**
 * Pesan error milik @elyvel/auth (Bahasa Indonesia) — dimuat otomatis di
 * bawah namespace `auth::` (lihat `I18nServiceProvider`'s auto-discovery).
 * App bisa override key tertentu lewat `lang/vendor/auth/id/errors.ts`.
 */
export default {
  unauthenticated: 'Tidak terautentikasi',
  unverified: 'Alamat email Anda belum terverifikasi.',
  unauthorized: 'Tindakan ini tidak diizinkan.',
  // Default Gate.deny()/denyAsNotFound() message when a policy doesn't pass its own.
  not_found: 'Tidak ditemukan.',

  // Pesan hasil normalisasi kode error Better Auth (lihat error-normalizer.ts).
  invalid_email: 'Alamat email tidak valid.',
  password_too_short: 'Kata sandi terlalu pendek.',
  password_too_long: 'Kata sandi terlalu panjang.',
  invalid_credentials: 'Kredensial ini tidak cocok dengan data kami.',
  sign_up_disabled: 'Pendaftaran sedang ditutup.',
  email_password_disabled: 'Masuk dengan email dan kata sandi dinonaktifkan.',
  reset_disabled: 'Reset kata sandi sedang tidak tersedia.',
}
