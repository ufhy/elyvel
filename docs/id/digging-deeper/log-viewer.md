# Log Viewer

Web UI mandiri untuk menelusuri file log aplikasimu sendiri — filter
berdasarkan level, full-text search, pagination, expand sebuah entri
untuk stack trace-nya, download atau hapus sebuah file. Tanpa build
step, tanpa dependency Vue/React — ia mengirimkan halaman
HTML/CSS/JS bertema gelapnya sendiri.

## Instalasi

```bash
bun add @elyvel/log-viewer
```

## Mount

```ts
// config/middleware.ts
import { logViewer } from '@elyvel/log-viewer'

export default defineMiddlewareConfig({
  global: [logViewer()],
})
```

```ts
logViewer({
  path: '/log-viewer',      // default
  logDir: 'storage/logs',   // default — di-resolve terhadap cwd jika relatif
})
```

Route yang didaftarkannya: `GET {path}` (shell HTML), `GET
{path}/api/files` (daftar file log), `GET
{path}/api/files/:name/entries` (entri berpaginasi dan bisa difilter —
query param `level`, `q`, `page`, `perPage`, `direction`), `GET
{path}/api/files/:name/download`, dan `DELETE {path}/api/files/:name`.

## Gate sendiri — wajib

::: warning Tidak ada otorisasi default
Berbeda dari halaman error debug, tidak ada default berbasis environment
di sini — tanpa `authorize` yang dikonfigurasi, **setiap request
ditolak**. Kamu harus menyambungkan ini secara eksplisit, bahkan di
production, sebelum log viewer melakukan apa pun yang berguna.
:::

Panggil sekali saat startup, dari service provider aplikasimu — tempat
yang sama dengan setup app-wide lainnya:

```ts
// app/providers/AppServiceProvider.ts
import type { User } from '@elyvel/auth'
import { ServiceProvider } from '@elyvel/core'
import { configureLogViewer } from '@elyvel/log-viewer'

const ADMIN_EMAILS = ['ada@example.com']

export class AppServiceProvider extends ServiceProvider {
  override boot(): void {
    configureLogViewer({
      authorize: ctx => ADMIN_EMAILS.includes((ctx.user as User | null)?.email ?? ''),
    })
  }
}
```

Dua bagian ini sengaja dipisah: `config/middleware.ts` menentukan
**apakah** viewer terpasang, provider menentukan **siapa** yang boleh
masuk. Mengatur `authorize` tanpa memasang `logViewer()` tidak
mendaftarkan route apa pun; memasangnya tanpa `authorize` menyajikan
viewer yang menolak semua orang.

`authorize(ctx)` mengembalikan (atau me-resolve ke) boolean. Aplikasi
sungguhan sebaiknya memeriksa role/permission alih-alih allowlist email
— gunakan setup [Otorisasi](/id/security/authorization) yang sudah kamu
pakai.

## Apa yang dibacanya

Ia memahami file log aktif, file berotasi-ukuran (`app.log.1`), dan file
berotasi-harian (`app-2026-07-19.log`) — lihat
[Logging](/id/digging-deeper/logging) untuk bagaimana itu dibuat. Ia
**tidak** membaca rotasi yang di-gzip-kompresi (`compress: true` milik
`FileTransport`) — biarkan kompresi mati untuk direktori log yang ingin
kamu telusuri di sini.

Mode JSON (satu object JSON per baris, default) vs. mode pretty/teks
(`pretty: true`) dideteksi **per baris**, sehingga file yang memuat
keduanya — yang terjadi ketika formatnya berubah sementara file-nya tetap
hidup — tetap terbaca seluruhnya. Di mode pretty hanya
`time`/`level`/`name`/`message` yang di-parse sebagai field terstruktur;
sisanya (context, stack trace) kembali apa adanya sebagai teks mentah,
karena bisa mengandung newline sungguhan yang tidak bisa di-parse ulang
dengan aman. Itu satu alasan memilih JSON untuk file: context di mode
pretty tidak bisa difilter.

Tidak ada index di disk — setiap request memuat file yang relevan ke
memori, yang cukup baik pada ukuran rotasi default 5MB tapi tidak
dirancang untuk menelusuri arsip log skala gigabyte.

## Testing

`resetLogViewerConfig()` mengosongkan fungsi `authorize` yang
dikonfigurasi kembali ke "tolak semuanya" — pakai di `beforeEach` jika
sebuah test suite mengkonfigurasi yang custom.
