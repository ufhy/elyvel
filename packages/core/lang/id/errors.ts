/**
 * Pesan halaman error & respons HTTP Bahasa Indonesia — dimuat otomatis di
 * bawah namespace `core::` (lihat `I18nServiceProvider`'s auto-discovery).
 * Kunci status (`401`, `404`, …) punya `title` + `message` untuk halaman
 * error; kunci pendek dipakai untuk body JSON pada respons seperti
 * 401/403/419/429. App bisa override key tertentu lewat
 * `lang/vendor/core/id/errors.ts`.
 */
export default {
  400: { title: 'Permintaan Buruk', message: 'Server tidak memahami permintaan ini.' },
  401: { title: 'Tidak Terautentikasi', message: 'Anda perlu masuk untuk melanjutkan.' },
  403: { title: 'Terlarang', message: 'Anda tidak punya izin mengakses halaman ini.' },
  404: { title: 'Halaman Tidak Ditemukan', message: 'Halaman yang Anda cari tidak ada.' },
  419: { title: 'Halaman Kedaluwarsa', message: 'Sesi Anda telah berakhir — muat ulang dan coba lagi.' },
  422: { title: 'Tidak Dapat Diproses', message: 'Data yang dikirim tidak dapat diproses.' },
  429: { title: 'Terlalu Banyak Permintaan', message: 'Pelan-pelan sedikit, coba lagi sebentar.' },
  500: { title: 'Kesalahan Server', message: 'Terjadi kesalahan di sisi kami.' },
  503: { title: 'Layanan Tidak Tersedia', message: 'Kami sedang tidak aktif sejenak — segera kembali.' },

  // Pesan pendek untuk body JSON/WS.
  throttle: 'Terlalu Banyak Permintaan',
  csrf: 'Token CSRF tidak cocok.',
  not_found: ':resource tidak ditemukan',
  unauthorized: 'Tidak diizinkan',
}
