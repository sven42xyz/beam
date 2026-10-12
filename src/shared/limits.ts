export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_TEXT_BYTES = 100 * 1024;
export const MAX_ITEMS = 50;
/** Rooms are deleted this long after their last activity ... */
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
/** ... and at the latest this long after creation, even if they stay active. */
export const ROOM_MAX_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cost ceiling: total size of all stored files (R2). Uploads beyond this are rejected.
 * At $0.015/GB-month this caps storage at well under $1/month.
 */
export const GLOBAL_FILE_STORAGE_BYTES = 50 * 1000 ** 3;
/** Upload volume (files + texts) per IP (IPv6: per /64) and UTC day. Deleting does not refund it. */
export const IP_DAILY_UPLOAD_BYTES = 2 * 1000 ** 3;
/** Uploads that stay "pending" this long are treated as aborted. */
export const PENDING_TIMEOUT_MS = 60 * 60 * 1000;
/** Encrypted texts as Base64url: plaintext + IV + tag, with headroom for the JSON wrapper */
export const MAX_CIPHERTEXT_CHARS = Math.ceil(((MAX_TEXT_BYTES + 1024) * 4) / 3);
/** Encrypted file metadata (name, type, size) in the X-Filename header */
export const MAX_ENC_META_CHARS = 2048;
