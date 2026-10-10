// Ende-zu-Ende-Verschlüsselung im Browser (Web Crypto, AES-256-GCM).
//
// Der Schlüssel entsteht beim Erstellen des Raums und steht nur im Fragment des
// Links (`/ABC234#k=…`). Browser schicken das Fragment nie an den Server.
//
// Texte und Metadaten: Base64url( IV[12] | Chiffretext+Tag )
//
// Dateien, in Blöcken, damit auch 100 MB auf dem Handy gehen:
//   Kopf[16]  = "TEE1" | Nonce-Präfix[8] | Blockgröße (u32, big endian)
//   Block i   = AES-GCM(Klartext[i]), IV = Präfix[8] | i (u32 BE),
//               AAD = [1] beim letzten Block, sonst [0]
// Der Zähler im IV verhindert das Vertauschen von Blöcken, das AAD-Flag das
// unbemerkte Abschneiden am Ende.

const MAGIC = [0x54, 0x45, 0x45, 0x31]; // "TEE1"
const HEADER_BYTES = 16;
const TAG_BYTES = 16;
const IV_BYTES = 12;
export const CHUNK_BYTES = 1024 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- Base64url ----------

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- Schlüssel ----------

/** Neuer zufälliger Raumschlüssel, als Base64url für den Link. */
export function generateKey(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function importKey(encoded: string): Promise<CryptoKey> {
  const raw = fromBase64Url(encoded);
  if (raw.length !== 32) throw new Error('invalid key');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Liest den Schlüssel aus einem Link-Fragment (`#k=…`). */
export function keyFromHash(hash: string): string | null {
  const match = /(?:^#|&)k=([A-Za-z0-9_-]{43})(?:&|$)/.exec(hash);
  return match ? match[1] : null;
}

// ---------- Kleine Daten (Texte, Metadaten) ----------

export async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(value))));
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv);
  out.set(ct, IV_BYTES);
  return toBase64Url(out);
}

export async function decryptJson<T>(key: CryptoKey, encoded: string): Promise<T> {
  const data = fromBase64Url(encoded);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: data.subarray(0, IV_BYTES) },
    key,
    data.subarray(IV_BYTES),
  );
  return JSON.parse(dec.decode(pt)) as T;
}

// ---------- Dateien ----------

/** Größe einer verschlüsselten Datei: Kopf + Klartext + ein Tag pro Block (mind. ein Block). */
export function encryptedSize(plainBytes: number): number {
  return HEADER_BYTES + plainBytes + TAG_BYTES * Math.max(1, Math.ceil(plainBytes / CHUNK_BYTES));
}

function chunkIv(prefix: Uint8Array, index: number): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(IV_BYTES);
  iv.set(prefix);
  new DataView(iv.buffer).setUint32(8, index);
  return iv;
}

const LAST = new Uint8Array([1]);
const NOT_LAST = new Uint8Array([0]);

/** Verschlüsselt eine Datei blockweise. Ergebnis ist ein Blob in exakt `encryptedSize(file.size)` Bytes. */
export async function encryptFile(key: CryptoKey, file: Blob, onProgress?: (done: number) => void): Promise<Blob> {
  const prefix = crypto.getRandomValues(new Uint8Array(8));
  const header = new Uint8Array(HEADER_BYTES);
  header.set(MAGIC);
  header.set(prefix, 4);
  new DataView(header.buffer).setUint32(12, CHUNK_BYTES);

  const parts: BlobPart[] = [header];
  const chunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
  for (let i = 0; i < chunks; i++) {
    const plain = await file.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).arrayBuffer();
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: chunkIv(prefix, i), additionalData: i === chunks - 1 ? LAST : NOT_LAST },
      key,
      plain,
    );
    parts.push(ct);
    onProgress?.(Math.min(file.size, (i + 1) * CHUNK_BYTES));
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

/** Entschlüsselt eine heruntergeladene Datei blockweise, während sie ankommt. */
export async function decryptStream(
  key: CryptoKey,
  body: ReadableStream<Uint8Array>,
  mime: string,
  onProgress?: (done: number) => void,
): Promise<Blob> {
  const reader = body.getReader();
  let buffer: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let received = 0;
  const append = (data: Uint8Array) => {
    const next = new Uint8Array(buffer.length + data.length);
    next.set(buffer);
    next.set(data, buffer.length);
    buffer = next;
  };

  // Kopf lesen
  let done = false;
  while (buffer.length < HEADER_BYTES && !done) {
    const r = await reader.read();
    done = r.done;
    if (r.value) append(r.value);
  }
  if (buffer.length < HEADER_BYTES || !MAGIC.every((b, i) => buffer[i] === b)) throw new Error('invalid file');
  const prefix = buffer.slice(4, 12);
  const chunkBytes = new DataView(buffer.buffer, buffer.byteOffset).getUint32(12);
  if (chunkBytes < 1 || chunkBytes > 16 * 1024 * 1024) throw new Error('invalid file');
  buffer = buffer.slice(HEADER_BYTES);

  const sealed = chunkBytes + TAG_BYTES;
  const parts: BlobPart[] = [];
  let index = 0;
  const decryptChunk = async (data: Uint8Array<ArrayBuffer>, last: boolean) => {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: chunkIv(prefix, index), additionalData: last ? LAST : NOT_LAST },
      key,
      data,
    );
    parts.push(pt);
    index++;
  };

  // Ein Block gilt erst als „nicht der letzte“, wenn danach noch Daten kommen
  while (!done) {
    const r = await reader.read();
    done = r.done;
    if (r.value) {
      received += r.value.length;
      append(r.value);
      onProgress?.(received);
    }
    while (buffer.length > sealed) {
      await decryptChunk(buffer.slice(0, sealed), false);
      buffer = buffer.slice(sealed);
    }
  }
  if (buffer.length < TAG_BYTES) throw new Error('truncated file');
  await decryptChunk(buffer, true);
  return new Blob(parts, { type: mime });
}
