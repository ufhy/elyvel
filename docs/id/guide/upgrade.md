# Panduan Upgrade

## Upgrade ke 0.1.0-alpha.4 dari alpha.3

Satu tema melandasi semua perubahan di bawah: **framework berhenti menyimpulkan
perilaku dari `APP_ENV`**. Variabel yang dinamai menurut environment diam-diam
menentukan format file log, apakah cookie session Secure, apakah stack trace
dirender, apakah permukaan API dipublikasikan, dan apakah tag aset menunjuk dev
server. Semua itu sekarang dibaca dari file config tempat setelan itu memang
berada. Kalau sebuah app ingin environment yang menentukan, ia menuliskannya di
config-nya sendiri, pada baris yang bisa kamu lihat dan hapus — pembagian yang
sama dengan Laravel.

Setiap poin diverifikasi ke source Laravel sebelum diubah.

### Vite: dev server dideteksi lewat hot file

**Dampak: besar, untuk app yang memakai `@elyvel/vite` atau `@elyvel/inertia`.**

Tambahkan plugin ke `vite.config.ts`:

```ts
import { elyvel } from '@elyvel/vite/plugin'

export default defineConfig({
  plugins: [elyvel(), /* ... */],
})
```

Plugin menulis `public/hot` selama dev server hidup dan menghapusnya saat keluar;
backend mengirim tag dev persis selama file itu ada. Tambahkan `public/hot` ke
`.gitignore`.

Dua konsekuensi:

- **Tanpa dev server dan tanpa manifest build**, render sekarang melempar error,
  bukan mengirim URL `http://localhost:5173/...`. Fallback itulah yang membuat
  deploy produksi dengan `APP_ENV` tidak di-set menyajikan URL aset ke mesin yang
  tidak ada — halaman ter-render, semua aset 404, server tidak mencatat apa pun.
- Test yang me-render halaman tanpa `vite build` sebaiknya memanggil
  `withoutVite()` (helper dengan nama sama seperti di Laravel):

  ```ts
  import { withoutVite } from '@elyvel/vite'

  withoutVite()
  ```

### Cookie session tidak Secure kecuali kamu menyatakannya

**Dampak: besar kalau kamu deploy lewat HTTPS dan mengandalkan default lama.**

`secure` dulu default ke `app.env === 'production'`. Sekarang default false dan
hanya datang dari config. Tambahkan di `config/session.ts`:

```ts
secure: process.env.SESSION_SECURE_COOKIE === 'true',
```

lalu set `SESSION_SECURE_COOKIE=true` di mana pun kamu menyajikan HTTPS. Default
lama juga gagal di arah sebaliknya: app berlabel production tapi diakses lewat
http polos menulis cookie Secure yang ditolak dikirim balik browser, sehingga
setiap session terbaca kosong tanpa catatan apa pun.

### `app.debug` default mati dan dituruti di mana pun

**Dampak: kecil, dan ke arah yang aman.**

Dulu default menyala lalu dipaksa mati di production. Sekarang default **false**
dan dituruti di semua environment. Untuk tetap mendapat halaman error detail di
lokal, tambahkan di `config/app.ts`:

```ts
debug: process.env.APP_DEBUG === 'true',
```

dan `APP_DEBUG=true` di `.env` lokal. Jangan pernah di host publik: nilainya
tidak lagi ditimpa untukmu.

### Ekspose OpenAPI adalah keputusan config

**Dampak: sedang — docs sekarang default MENYALA.**

`enabled` tidak lagi default ke `app.env !== 'production'`. Memasang peer opsional
`@elysiajs/openapi` itulah opt-in-nya. Untuk mematikan docs di production,
tuliskan di `config/openapi.ts` supaya terlihat:

```ts
enabled: process.env.OPENAPI_ENABLED
  ? process.env.OPENAPI_ENABLED === 'true'
  : process.env.APP_ENV !== 'production',
```

### File log berformat JSON; console mudah dibaca

**Dampak: sedang kalau kamu mem-parse file log sendiri.**

Format tidak lagi mengikuti `APP_ENV`. File selalu JSON di semua environment,
console mudah dibaca, dan `pretty` mengatur keduanya. File log hidup lebih lama
dari environment yang menulisnya, dan file bercampur dua format adalah file yang
salah dibaca — log viewer membaca 18 dari 64 entri pada satu file seperti itu.
Set `pretty: true` di `config/logging.ts` untuk mengembalikan format teks lama.

### Level log: delapan level RFC 5424

**Dampak: tidak ada untuk kode yang sudah ada.**

`notice`, `warning`, `critical`, `alert`, dan `emergency` bergabung dengan
`debug`, `info`, dan `error`. `warn()` tetap berfungsi dan dicatat sebagai
`warning`, jadi file dan filter melihat satu nama untuk satu level. Semua yang
`warning` ke atas sekarang ditulis ke stderr.

### Channel, `LOG_CHANNEL`, dan driver `null`

**Dampak: tidak ada kecuali kamu mengadopsinya.**

`config/logging.ts` bisa memakai bentuk channel bernama (`stack`, `console`,
`single`, `daily`, `null`) dengan `default: process.env.LOG_CHANNEL ?? 'stack'`.
`LOG_CHANNEL=null` lalu membungkam logging tanpa menghapus konfigurasi yang
mencatat ke mana log seharusnya pergi. `app.log.build({...})` dan
`app.log.stack([...])` membuat logger di tempat pemakaian.
