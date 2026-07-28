# Static Files

Layani sebuah direktori file polos — gambar yang diupload, asset frontend
yang sudah dibuild — di bawah prefix URL (disk `public/` milik Laravel).

## Pemakaian

```ts
import { staticFiles } from '@elyvel/core'

route().use(staticFiles({ dir: 'public/build', prefix: '/build' }))
```

Request apa pun di bawah `/build/*` di-resolve terhadap `public/build/` di
disk dan dikirim balik dengan content type yang tepat; file yang hilang
404.

`dir` relatif terhadap working directory proses (atau path absolut);
`prefix` defaultnya root (`''`) jika dikosongkan.

::: tip Sudah tersambung untuk kamu
[Inertia & Vue](/id/basics/inertia) dan [mode SPA](/id/basics/spa)
keduanya memanggil `staticFiles()` secara internal untuk melayani asset
Vite yang sudah dibuild — kamu hanya butuh ini secara langsung untuk
direktori statis milikmu sendiri (misalnya gambar publik hasil upload
user).
:::

## Path traversal diblokir

Request path yang me-resolve ke luar `dir` (gaya traversal
`../../etc/passwd`) mendapat `403` alih-alih pernah menyentuh file di luar
direktori yang dilayani — ini diterapkan tanpa syarat, bukan opt-in.
