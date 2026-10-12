export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_TEXT_BYTES = 100 * 1024;
export const MAX_ITEMS = 50;
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
/** Uploads that stay "pending" this long are treated as aborted. */
export const PENDING_TIMEOUT_MS = 60 * 60 * 1000;
/** Encrypted texts as Base64url: plaintext + IV + tag, with headroom for the JSON wrapper */
export const MAX_CIPHERTEXT_CHARS = Math.ceil(((MAX_TEXT_BYTES + 1024) * 4) / 3);
/** Encrypted file metadata (name, type, size) in the X-Filename header */
export const MAX_ENC_META_CHARS = 2048;
