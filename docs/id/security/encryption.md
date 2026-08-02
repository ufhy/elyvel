# Enkripsi

Enkripsi simetris terautentikasi — `Crypt` milik Laravel. AES-256-GCM, dengan
kunci `app.key`, secret yang sama di balik URL bertanda tangan, cookie session,
dan cast model `encrypted`.

```ts
import { Crypt } from '@elyvel/core'

const payload = Crypt.encryptString('hunter2')
Crypt.decryptString(payload) // 'hunter2'

// Nilai apa pun yang bisa di-JSON, sebagaimana encrypt() Laravel yang serialisasi:
const token = Crypt.encrypt({ userId: 7, scope: ['read'] })
Crypt.decrypt<{ userId: number }>(token).userId // 7
```

`encrypt`/`decrypt`/`encryptString`/`decryptString` juga diekspor langsung kalau
kamu lebih suka fungsi biasa.

## Apa gunanya "terautentikasi"

Ciphertext membawa tag GCM, jadi payload yang diubah **gagal dengan keras**,
bukan mendekripsi jadi plaintext lain:

```ts
Crypt.decryptString(tampered)
// Error: Cannot decrypt: wrong key, or the payload was modified after it was encrypted.
```

Setiap panggilan memakai IV acak baru, sehingga mengenkripsi nilai yang sama dua
kali menghasilkan keluaran berbeda. Itu disengaja — ciphertext identik untuk
input identik membocorkan record mana yang isinya sama.

## Kuncinya

Set `APP_KEY` (`.env` hasil scaffold sudah memuatnya, dan `bun run key:generate`
mengisinya). Kunci kosong **ditolak**, bukan diterima: meng-hash string kosong
akan menghasilkan kunci yang sama persis di setiap instalasi, dan aplikasi yang
ter-deploy dengan `APP_KEY=` akan mengenkripsi semuanya memakai secret yang bisa
ditebak tanpa tanda apa pun bahwa ada yang salah.

`Crypt.hasKey()` melaporkan apakah kuncinya sudah ada, untuk kode yang lebih
memilih menurunkan fungsi daripada melempar error.

## Kolom model

Cast `encrypted` memakai implementasi dan format payload yang sama, jadi nilai
yang ditulis cast bisa didekripsi dengan `Crypt`, dan sebaliknya:

```ts
class User extends Model {
  static casts = { ssn: 'encrypted' }
}
```

## `appearsEncrypted`

Pemeriksaan **bentuk**, berguna saat memigrasikan kolom yang isinya campuran
terenkripsi dan plaintext. Ia tidak bisa membedakan payload palsu dari yang asli
— hanya `decrypt` yang bisa, dan untuk itulah tag autentikasi ada.

```ts
Crypt.appearsEncrypted(row.ssn) ? Crypt.decryptString(row.ssn) : row.ssn
```
