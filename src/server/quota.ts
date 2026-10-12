import { DurableObject } from 'cloudflare:workers';
import { GLOBAL_FILE_STORAGE_BYTES, IP_DAILY_UPLOAD_BYTES } from '../shared/limits';

export type QuotaError = 'storage_full' | 'quota_exceeded';
export type QuotaResult = { ok: true } | { ok: false; error: QuotaError };

/** Recount the stored file bytes from R2 every 6 hours, so the counter cannot drift. */
const RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Per-IP rows older than this are deleted. */
const IP_ROW_RETENTION_DAYS = 2;

const day = (ts = Date.now()) => new Date(ts).toISOString().slice(0, 10);

/**
 * Collapses an address to the unit an attacker cannot cheaply rotate:
 * IPv4 as is, IPv6 by its /64 prefix (a single connection usually owns a whole /64).
 */
export function ipBucket(ip: string): string {
  if (!ip.includes(':')) return ip;
  const [head, tail = ''] = ip.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Single Durable Object (`idFromName('global')`) that caps what tee can cost:
 *
 * - **Global file storage**: bytes currently stored in R2. Rooms report uploads and
 *   deletions; an alarm recounts the real total from R2 every few hours.
 * - **Upload volume per IP and day**: files and texts. Deleting does not refund it,
 *   otherwise delete-and-reupload would bypass the limit. Only a SHA-256 hash of
 *   day + IP bucket is stored, and rows are dropped after two days.
 */
export class Quota extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS ip_usage (
        id TEXT PRIMARY KEY,
        day TEXT NOT NULL,
        bytes INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ip_usage_day ON ip_usage (day);
    `);
  }

  private get fileBytes(): number {
    return this.sql.exec<{ value: number }>(`SELECT value FROM counters WHERE name = 'file_bytes'`).toArray()[0]?.value ?? 0;
  }

  private set fileBytes(value: number) {
    this.sql.exec(`INSERT OR REPLACE INTO counters (name, value) VALUES ('file_bytes', ?)`, Math.max(0, value));
  }

  private async ensureAlarm() {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + RECONCILE_INTERVAL_MS);
    }
  }

  /** Reserves `bytes` for an upload. Call `releaseFile` if a reserved file never gets stored. */
  async reserve(ip: string, bytes: number, kind: 'file' | 'text'): Promise<QuotaResult> {
    await this.ensureAlarm();

    if (kind === 'file' && this.fileBytes + bytes > GLOBAL_FILE_STORAGE_BYTES) {
      return { ok: false, error: 'storage_full' };
    }

    const today = day();
    const id = await sha256(`${today}:${ipBucket(ip)}`);
    const used = this.sql.exec<{ bytes: number }>('SELECT bytes FROM ip_usage WHERE id = ?', id).toArray()[0]?.bytes ?? 0;
    if (used + bytes > IP_DAILY_UPLOAD_BYTES) return { ok: false, error: 'quota_exceeded' };

    this.sql.exec(
      'INSERT INTO ip_usage (id, day, bytes) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET bytes = bytes + excluded.bytes',
      id,
      today,
      bytes,
    );
    if (kind === 'file') this.fileBytes = this.fileBytes + bytes;
    return { ok: true };
  }

  /** A stored file was deleted (or an upload failed): free its bytes in the global total. */
  releaseFile(bytes: number) {
    this.fileBytes = this.fileBytes - bytes;
  }

  /** For tests and monitoring. */
  status(): { fileBytes: number; limit: number } {
    return { fileBytes: this.fileBytes, limit: GLOBAL_FILE_STORAGE_BYTES };
  }

  async alarm() {
    // Recount the real total from R2. Uploads in flight are briefly missing from it,
    // which only errs on the generous side and is corrected by the next run.
    let total = 0;
    let cursor: string | undefined;
    do {
      const list = await this.env.FILES.list({ cursor, limit: 1000 });
      for (const object of list.objects) total += object.size;
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    this.fileBytes = total;

    const cutoff = day(Date.now() - IP_ROW_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    this.sql.exec('DELETE FROM ip_usage WHERE day < ?', cutoff);

    await this.ctx.storage.setAlarm(Date.now() + RECONCILE_INTERVAL_MS);
  }
}
