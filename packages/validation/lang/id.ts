/**
 * Pesan validasi Bahasa Indonesia — dimuat otomatis di bawah namespace
 * `validation::` (lihat `I18nServiceProvider`'s auto-discovery). Kunci = nama
 * rule; aturan berukuran (min/max/between/size) punya varian per tipe.
 * `:attribute`, `:min`, `:max`, dll. diganti otomatis. Nama field bisa
 * dilokalkan lewat `attributes` di bawah. App bisa override key tertentu
 * lewat `lang/vendor/validation/id/validation.ts`.
 */
export default {
  required: 'Kolom :attribute wajib diisi.',
  required_if: 'Kolom :attribute wajib diisi ketika :other bernilai :value.',
  required_with: 'Kolom :attribute wajib diisi ketika :values ada.',
  present: 'Kolom :attribute wajib ada.',
  filled: 'Kolom :attribute wajib memiliki nilai.',
  string: 'Kolom :attribute harus berupa teks.',
  integer: 'Kolom :attribute harus berupa bilangan bulat.',
  numeric: 'Kolom :attribute harus berupa angka.',
  boolean: 'Kolom :attribute harus bernilai benar atau salah.',
  array: 'Kolom :attribute harus berupa larik.',
  email: 'Kolom :attribute harus berupa alamat email yang valid.',
  url: 'Kolom :attribute harus berupa URL yang valid.',
  uuid: 'Kolom :attribute harus berupa UUID yang valid.',
  ip: 'Kolom :attribute harus berupa alamat IP yang valid.',
  json: 'Kolom :attribute harus berupa string JSON yang valid.',
  alpha: 'Kolom :attribute hanya boleh berisi huruf.',
  alpha_num: 'Kolom :attribute hanya boleh berisi huruf dan angka.',
  alpha_dash: 'Kolom :attribute hanya boleh berisi huruf, angka, strip, dan garis bawah.',
  confirmed: 'Konfirmasi :attribute tidak cocok.',
  same: 'Kolom :attribute dan :other harus sama.',
  different: 'Kolom :attribute dan :other harus berbeda.',
  in: 'Kolom :attribute yang dipilih tidak valid.',
  not_in: 'Kolom :attribute yang dipilih tidak valid.',
  regex: 'Format kolom :attribute tidak valid.',
  date: 'Kolom :attribute harus berupa tanggal yang valid.',
  date_format: 'Kolom :attribute harus sesuai format :format.',
  before: 'Kolom :attribute harus berupa tanggal sebelum :date.',
  after: 'Kolom :attribute harus berupa tanggal setelah :date.',
  unique: 'Kolom :attribute sudah digunakan.',
  exists: 'Kolom :attribute yang dipilih tidak valid.',
  min: {
    numeric: 'Kolom :attribute minimal :min.',
    string: 'Kolom :attribute minimal :min karakter.',
    array: 'Kolom :attribute minimal :min item.',
    file: 'Kolom :attribute minimal :min kilobita.',
  },
  max: {
    numeric: 'Kolom :attribute maksimal :max.',
    string: 'Kolom :attribute maksimal :max karakter.',
    array: 'Kolom :attribute maksimal :max item.',
    file: 'Kolom :attribute maksimal :max kilobita.',
  },
  between: {
    numeric: 'Kolom :attribute harus antara :min dan :max.',
    string: 'Kolom :attribute harus antara :min dan :max karakter.',
    array: 'Kolom :attribute harus antara :min dan :max item.',
    file: 'Kolom :attribute harus antara :min dan :max kilobita.',
  },
  size: {
    numeric: 'Kolom :attribute harus bernilai :size.',
    string: 'Kolom :attribute harus :size karakter.',
    array: 'Kolom :attribute harus berisi :size item.',
    file: 'Kolom :attribute harus :size kilobita.',
  },

  // Nama field yang ramah pengguna (opsional).
  attributes: {
    email: 'email',
    password: 'kata sandi',
    name: 'nama',
  },

  // Pesan ValidationException (dikirim ke client sebagai `message` di respons 422).
  exception: {
    invalid: 'Data yang dikirim tidak valid.',
    and_one_more: 'dan 1 error lagi',
    and_more: 'dan :count error lagi',
    // Default AuthorizationException message ketika FormRequest.authorize() menolak.
    unauthorized: 'Tindakan ini tidak diizinkan.',
  },
}
