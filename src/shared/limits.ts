export const MAX_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_TEXT_BYTES = 100 * 1024;
export const MAX_ITEMS = 50;
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;
/** Uploads, die so lange "pending" sind, gelten als abgebrochen. */
export const PENDING_TIMEOUT_MS = 60 * 60 * 1000;
/** Verschlüsselte Texte als Base64url: Klartext + IV + Tag, mit Puffer für JSON-Hülle */
export const MAX_CIPHERTEXT_CHARS = Math.ceil(((MAX_TEXT_BYTES + 1024) * 4) / 3);
/** Verschlüsselte Datei-Metadaten (Name, Typ, Größe) im X-Filename-Header */
export const MAX_ENC_META_CHARS = 2048;
