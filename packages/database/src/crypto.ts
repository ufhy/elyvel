/**
 * The `encrypted` cast's crypto, now living in `@elyvel/support` so it isn't
 * reachable only through the ORM — an app encrypting anything that isn't a model
 * column had to import this file's internals or hand-roll AES.
 *
 * Re-exported (not reimplemented) so there is exactly one payload format: values
 * already written by the cast keep decrypting, and a change to one is a change to
 * both.
 */
export { decryptString as decrypt, encryptString as encrypt, setEncryptionKey } from '@elyvel/support'
