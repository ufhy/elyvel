# Pengembangan Paket

Cara membangun sesuatu yang dipasang orang lain di samping elyvel — driver,
notification channel, kumpulan command. Benang merahnya: **framework tidak pernah
perlu tahu paketmu ada.** Setiap titik ekstensi di bawah juga dipakai oleh
bawaan.

## Service provider, auto-discovery

Ekspor `elyvelProviders` dari entry utama paketmu dan `elyvel package:discover`
(berjalan otomatis saat install lewat `postinstall`) mendaftarkannya ke
`bootstrap/providers.generated.ts`:

```ts
// src/index.ts
export class AcmeServiceProvider extends ServiceProvider {
  override register(): void { /* bind ke container */ }
  override boot(): void { /* berjalan setelah semua provider ter-register */ }
}

export const elyvelProviders = [AcmeServiceProvider]
```

Aplikasi bisa mengecualikan paket dari discovery dengan `dontDiscover` di
`config/app.ts`, lalu mendaftarkan provider-nya sendiri.

## Command CLI

Ekspor `elyvelCommands` dari **subpath `/cli` terpisah** — jangan dari entry
utama, supaya mengimpor paketmu saat runtime tidak menarik kode command (dan
impor `node:fs`-nya) ke proses aplikasi:

```ts
// src/cli.ts, diekspos sebagai "@acme/thing/cli" di `exports` package.json
export const elyvelCommands: ConsoleCommand[] = [{
  name: 'acme:sync',
  description: 'Sinkronkan semuanya',
  async run(flags, args) { /* … */ return 0 },
}]
```

Discovery menulisnya ke `bootstrap/commands.generated.ts`; uji in-process dengan
[`runCommand`](/id/digging-deeper/testing#menguji-console-command).

## Driver

Setiap subsistem yang memilih implementasi berdasarkan nama menerima driver yang
didaftarkan — transport mail, backend queue, cache store, disk, session store,
log channel, broadcaster, driver database. Lihat
[Menulis Driver](/id/packages/writing-drivers) untuk kontrak lengkapnya;
singkatnya:

```ts
export class AcmeServiceProvider extends ServiceProvider {
  override boot(): void {
    this.app.make(MailToken).extend('acme', cfg => new AcmeTransport(cfg))
  }
}
```

## Notification channel

Tanpa registrasi sama sekali — kelasnya adalah identitasnya. Ekspor; aplikasi
menyebutnya di `via()`:

```ts
export class WhatsAppChannel {
  async send(notifiable: Notifiable, notification: Notification): Promise<void> {
    const message = notification.toWhatsApp?.(notifiable)
    // …
  }
}
```

## Rule validasi

```ts
import { registerRule } from '@elyvel/validation'

registerRule('phone', (value, [country = 'ID']) => isPhone(String(value), country),
  'Kolom :attribute harus berupa nomor telepon yang valid.')
```

Pesannya hanya fallback — terjemahan `validation::phone` milik aplikasi
menimpanya, jadi rule-mu bisa dilokalkan tanpa keterlibatanmu.

## Config dan terjemahan

Kirim default di dalam paketmu dan baca lewat `config('acme.…')`; aplikasi
menimpa dengan membuat `config/acme.ts`. Terjemahan di `lang/` paketmu dimuat ke
namespace (`acme::key`) dan bisa ditimpa dari `lang/vendor/acme/`.

## Publishing

- Kirim source TypeScript (`files: ["src"]` plus semua direktori aset runtime —
  `templates/`, `stubs/`, `lang/`; melupakan satu tidak terlihat sampai sebuah
  install gagal).
- Peer-depend pada paket `@elyvel/*` yang kamu impor; jangan pernah mem-bundle.
- Satu pengecualian: kode yang harus dimuat proses **Node** (plugin Vite,
  misalnya) harus `.mjs` polos — Vite memuat `vite.config.ts` di bawah Node, yang
  tidak bisa mengimpor TypeScript mentah.
