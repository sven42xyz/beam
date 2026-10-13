import { DurableObject } from 'cloudflare:workers';
import { MAX_ITEMS, PENDING_TIMEOUT_MS, ROOM_FREEZE_MAX_MS, ROOM_MAX_LIFETIME_MS, ROOM_TTL_MS } from '../shared/limits';
import type { QuotaError } from './quota';
import type { Item, ItemKind, ServerMessage } from '../shared/types';

type ItemRow = {
  id: string;
  kind: ItemKind;
  content: string | null;
  file_name: string | null;
  file_size: number | null;
  mime: string | null;
  r2_key: string | null;
  status: 'pending' | 'ready';
  created_at: number;
};

/** wrong_mode: plaintext sent to an encrypted room (or the other way round) */
/** room_blocked: the operator (or a CSAM report) has blocked the room */
export type RoomError = 'not_found' | 'room_full' | 'wrong_mode' | 'room_blocked' | QuotaError;
export type Result<T> = { ok: true; value: T } | { ok: false; error: RoomError };

function toItem(row: ItemRow, enc: boolean): Item {
  const base = { id: row.id, kind: row.kind, createdAt: row.created_at, ...(enc && { enc: true }) };
  if (row.kind === 'file') {
    return {
      ...base,
      name: row.file_name ?? 'datei',
      size: row.file_size ?? 0,
      mime: row.mime ?? 'application/octet-stream',
    };
  }
  return { ...base, content: row.content ?? '' };
}

/**
 * One room = one Durable Object (SQLite-backed).
 * Live sync via the WebSocket Hibernation API, cleanup via an alarm.
 */
export class Room extends DurableObject<Env> {
  private sql: SqlStorage;
  /** The schema is only created in init(), so requests for unknown codes leave no storage behind. */
  private hasSchema: boolean;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.hasSchema =
      this.sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`).toArray().length > 0;
    // Answers "ping" without waking the DO from hibernation
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private createSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        content TEXT,
        file_name TEXT,
        file_size INTEGER,
        mime TEXT,
        r2_key TEXT,
        status TEXT NOT NULL DEFAULT 'ready',
        created_at INTEGER NOT NULL
      );
    `);
    this.hasSchema = true;
  }

  // ---------- Meta ----------

  private getMeta(key: string): string | null {
    if (!this.hasSchema) return null;
    const row = this.sql.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key).toArray()[0];
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string) {
    this.sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
  }

  private get code(): string | null {
    return this.getMeta('code');
  }

  /** End-to-end encrypted room: content is ciphertext the server cannot read. */
  private get encrypted(): boolean {
    return this.getMeta('encrypted') === '1';
  }

  private item(row: ItemRow): Item {
    return toItem(row, this.encrypted);
  }

  /** When the room will be deleted: 24 h after the last activity, at most 7 days after creation. */
  private expiry(lastActivity: number): number {
    const createdAt = Number(this.getMeta('created_at') ?? lastActivity);
    return Math.min(lastActivity + ROOM_TTL_MS, createdAt + ROOM_MAX_LIFETIME_MS);
  }

  /** Activity: push the expiry out (within the maximum lifetime). */
  private async touch(): Promise<number> {
    const now = Date.now();
    this.setMeta('last_activity', String(now));
    const expiresAt = this.expiry(now);
    await this.ctx.storage.setAlarm(expiresAt);
    return expiresAt;
  }

  private get quota() {
    return this.env.QUOTA.get(this.env.QUOTA.idFromName('global'));
  }

  // ---------- RPC ----------

  /** Creates the room. Returns false if the code is already taken. */
  async init(code: string, encrypted: boolean): Promise<boolean> {
    if (this.code) return false;
    this.createSchema();
    this.setMeta('code', code);
    this.setMeta('encrypted', encrypted ? '1' : '0');
    this.setMeta('created_at', String(Date.now()));
    await this.touch();
    return true;
  }

  exists(): boolean {
    return this.code !== null;
  }

  /** null if the room does not exist (any more). */
  info(): { encrypted: boolean; blocked: boolean } | null {
    return this.code ? { encrypted: this.encrypted, blocked: this.blocked } : null;
  }

  /** Blocked rooms keep their data (until they expire as usual) but serve nothing. */
  private get blocked(): boolean {
    return this.getMeta('blocked') === '1';
  }

  /** Overview for the moderation page. Never includes content. */
  stats() {
    if (!this.code) return null;
    const row = this.sql
      .exec<{ items: number; files: number; bytes: number | null }>(
        `SELECT COUNT(*) AS items, SUM(kind = 'file') AS files, SUM(file_size) AS bytes FROM items`,
      )
      .one();
    const lastActivity = Number(this.getMeta('last_activity'));
    return {
      encrypted: this.encrypted,
      blocked: this.blocked,
      blockedReason: this.getMeta('blocked_reason'),
      frozenUntil: this.frozenUntil,
      createdAt: Number(this.getMeta('created_at')),
      lastActivity,
      expiresAt: this.expiry(lastActivity),
      items: row.items,
      files: row.files ?? 0,
      fileBytes: row.bytes ?? 0,
      devices: this.ctx.getWebSockets().length,
    };
  }

  /** Frozen rooms are kept (blocked) for the authorities until this time, instead of expiring. */
  private get frozenUntil(): number | null {
    const value = Number(this.getMeta('frozen_until') ?? 0);
    return value > 0 ? value : null;
  }

  /**
   * Operator actions:
   * - block: nothing is served any more, every device is disconnected; the room still expires as usual
   * - freeze: block and keep the data for up to 90 days (e.g. for a preservation order), ignoring expiry
   * - unblock: back to normal, including normal expiry
   * - delete: remove the room and its files right away
   */
  async moderate(action: 'block' | 'freeze' | 'unblock' | 'delete', reason = ''): Promise<boolean> {
    if (!this.code) return false;
    if (action === 'delete') {
      await this.destroy(4410, 'Room deleted');
      return true;
    }
    const blocking = action !== 'unblock';
    this.setMeta('blocked', blocking ? '1' : '0');
    this.setMeta('blocked_reason', blocking ? reason.slice(0, 200) : '');
    if (action === 'freeze') {
      const until = Date.now() + ROOM_FREEZE_MAX_MS;
      this.setMeta('frozen_until', String(until));
      await this.ctx.storage.setAlarm(until);
    } else {
      this.setMeta('frozen_until', '0');
      await this.ctx.storage.setAlarm(this.expiry(Number(this.getMeta('last_activity'))));
    }
    if (blocking) this.closeAll(4451, 'Room blocked');
    return true;
  }

  /**
   * Plaintext rooms receive `{ text, kind }`, encrypted rooms `{ ciphertext }`.
   * Whether an encrypted item is text or a link is part of the ciphertext.
   */
  async addText(
    payload: { text: string; kind: 'text' | 'link' } | { ciphertext: string },
    ip: string,
  ): Promise<Result<Item>> {
    if (!this.code) return { ok: false, error: 'not_found' };
    if (this.blocked) return { ok: false, error: 'room_blocked' };
    const isCipher = 'ciphertext' in payload;
    if (isCipher !== this.encrypted) return { ok: false, error: 'wrong_mode' };
    const content = isCipher ? payload.ciphertext : payload.text;
    const kind = isCipher ? 'text' : payload.kind;
    if (this.countItems() >= MAX_ITEMS) return { ok: false, error: 'room_full' };

    const quota = await this.quota.reserve(ip, new TextEncoder().encode(content).length, 'text');
    if (!quota.ok) return quota;
    // Other requests may have been handled while waiting for the quota: check again
    if (!this.code) return { ok: false, error: 'not_found' };
    if (this.countItems() >= MAX_ITEMS) return { ok: false, error: 'room_full' };

    const row: ItemRow = {
      id: crypto.randomUUID(),
      kind,
      content,
      file_name: null,
      file_size: null,
      mime: null,
      r2_key: null,
      status: 'ready',
      created_at: Date.now(),
    };
    this.insert(row);
    const item = this.item(row);
    this.broadcast({ type: 'item', item, expiresAt: await this.touch() });
    return { ok: true, value: item };
  }

  /** Reserves a slot for an upload. The item stays invisible until commitFile(). */
  /** In encrypted rooms, `name` is the ciphertext of name, type and original size. */
  async reserveFile(
    name: string,
    size: number,
    mime: string,
    encrypted: boolean,
    ip: string,
  ): Promise<Result<{ id: string; r2Key: string }>> {
    const code = this.code;
    if (!code) return { ok: false, error: 'not_found' };
    if (this.blocked) return { ok: false, error: 'room_blocked' };
    if (encrypted !== this.encrypted) return { ok: false, error: 'wrong_mode' };
    await this.cleanupStalePending();
    if (this.countItems() >= MAX_ITEMS) return { ok: false, error: 'room_full' };

    const id = crypto.randomUUID();
    const r2Key = `rooms/${code}/${id}`;
    this.insert({
      id,
      kind: 'file',
      content: null,
      file_name: name,
      file_size: size,
      mime,
      r2_key: r2Key,
      status: 'pending',
      created_at: Date.now(),
    });
    // The pending row already counts towards the item limit, so parallel uploads cannot overshoot it
    const quota = await this.quota.reserve(ip, size, 'file');
    if (!quota.ok) {
      this.sql.exec('DELETE FROM items WHERE id = ?', id);
      return quota;
    }
    await this.touch();
    return { ok: true, value: { id, r2Key } };
  }

  async commitFile(id: string): Promise<Result<Item>> {
    if (!this.code) return { ok: false, error: 'not_found' };
    this.sql.exec(`UPDATE items SET status = 'ready', created_at = ? WHERE id = ? AND status = 'pending'`, Date.now(), id);
    const row = this.getRow(id);
    if (!row || row.status !== 'ready') return { ok: false, error: 'not_found' };
    const item = this.item(row);
    this.broadcast({ type: 'item', item, expiresAt: await this.touch() });
    return { ok: true, value: item };
  }

  async abortFile(id: string): Promise<void> {
    const row = this.getRow(id);
    if (!row || row.status !== 'pending') return;
    this.sql.exec('DELETE FROM items WHERE id = ?', id);
    if (row.r2_key) await this.env.FILES.delete(row.r2_key);
    await this.quota.releaseFile(row.file_size ?? 0);
  }

  getFile(id: string): { r2Key: string; name: string; size: number; mime: string; encrypted: boolean } | 'blocked' | null {
    if (this.blocked) return 'blocked';
    const row = this.getRow(id);
    if (!row || row.kind !== 'file' || row.status !== 'ready' || !row.r2_key) return null;
    return {
      r2Key: row.r2_key,
      name: row.file_name ?? 'datei',
      size: row.file_size ?? 0,
      mime: row.mime ?? 'application/octet-stream',
      encrypted: this.encrypted,
    };
  }

  async deleteItem(id: string): Promise<boolean | 'blocked'> {
    if (this.blocked) return 'blocked';
    const row = this.getRow(id);
    if (!row || row.status !== 'ready') return false;
    this.sql.exec('DELETE FROM items WHERE id = ?', id);
    if (row.r2_key) {
      await this.env.FILES.delete(row.r2_key);
      await this.quota.releaseFile(row.file_size ?? 0);
    }
    this.broadcast({ type: 'delete', id, expiresAt: await this.touch() });
    return true;
  }

  // ---------- WebSockets (Hibernation API) ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    if (!this.code) return new Response('Room not found', { status: 404 });
    if (this.blocked) return new Response('Room blocked', { status: 451 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    const expiresAt = await this.touch();
    const devices = this.ctx.getWebSockets().length;
    const maxExpiresAt = Number(this.getMeta('created_at')) + ROOM_MAX_LIFETIME_MS;
    server.send(
      JSON.stringify({
        type: 'init',
        items: this.listItems(),
        devices,
        expiresAt,
        maxExpiresAt,
        encrypted: this.encrypted,
      } satisfies ServerMessage),
    );
    this.broadcast({ type: 'devices', count: devices }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer) {
    // Clients only send "ping" (answered by the auto-response). Everything else goes over HTTP.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
    this.broadcastDeviceCount(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.broadcastDeviceCount(ws);
  }

  // ---------- Alarm: delete the room after 24 h of inactivity ----------

  async alarm() {
    // Frozen for the authorities: keep until the freeze ends
    const frozenUntil = this.frozenUntil;
    if (frozenUntil && Date.now() < frozenUntil) {
      await this.ctx.storage.setAlarm(frozenUntil);
      return;
    }
    const lastActivity = Number(this.getMeta('last_activity') ?? 0);
    if (!frozenUntil && lastActivity && Date.now() < this.expiry(lastActivity)) {
      // Activity in the meantime: reschedule
      await this.ctx.storage.setAlarm(this.expiry(lastActivity));
      return;
    }

    await this.destroy(4404, 'Room expired');
  }

  /** Deletes all files, frees their quota, disconnects everyone and wipes the room's storage. */
  private async destroy(closeCode: number, closeReason: string) {
    const code = this.code;
    if (code) {
      const stored = this.sql
        .exec<{ bytes: number | null }>(`SELECT SUM(file_size) AS bytes FROM items WHERE kind = 'file'`)
        .one().bytes;
      await this.deleteR2Prefix(`rooms/${code}/`);
      if (stored) await this.quota.releaseFile(stored);
    }
    this.closeAll(closeCode, closeReason);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.hasSchema = false;
  }

  private closeAll(closeCode: number, closeReason: string) {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(closeCode, closeReason);
      } catch {
        // ignore
      }
    }
  }

  // ---------- Helpers ----------

  private insert(row: ItemRow) {
    this.sql.exec(
      `INSERT INTO items (id, kind, content, file_name, file_size, mime, r2_key, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.kind,
      row.content,
      row.file_name,
      row.file_size,
      row.mime,
      row.r2_key,
      row.status,
      row.created_at,
    );
  }

  private getRow(id: string): ItemRow | undefined {
    if (!this.hasSchema) return undefined;
    return this.sql.exec<ItemRow>('SELECT * FROM items WHERE id = ?', id).toArray()[0];
  }

  /** Also counts uploads in progress, so parallel uploads cannot exceed the limit. */
  private countItems(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM items').one().n;
  }

  private listItems(): Item[] {
    return this.sql
      .exec<ItemRow>(`SELECT * FROM items WHERE status = 'ready' ORDER BY created_at DESC`)
      .toArray()
      .map((row) => this.item(row));
  }

  private async cleanupStalePending() {
    const cutoff = Date.now() - PENDING_TIMEOUT_MS;
    const stale = this.sql
      .exec<{ id: string; r2_key: string | null; file_size: number | null }>(
        `SELECT id, r2_key, file_size FROM items WHERE status = 'pending' AND created_at < ?`,
        cutoff,
      )
      .toArray();
    if (stale.length === 0) return;
    this.sql.exec(`DELETE FROM items WHERE status = 'pending' AND created_at < ?`, cutoff);
    const keys = stale.map((s) => s.r2_key).filter((k): k is string => !!k);
    if (keys.length) await this.env.FILES.delete(keys);
    await this.quota.releaseFile(stale.reduce((sum, s) => sum + (s.file_size ?? 0), 0));
  }

  private async deleteR2Prefix(prefix: string) {
    let cursor: string | undefined;
    do {
      const list = await this.env.FILES.list({ prefix, cursor, limit: 1000 });
      if (list.objects.length) await this.env.FILES.delete(list.objects.map((o) => o.key));
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  }

  private broadcast(message: ServerMessage, except?: WebSocket) {
    const data = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        // socket is closing
      }
    }
  }

  private broadcastDeviceCount(closing: WebSocket) {
    const open = this.ctx.getWebSockets().filter((ws) => ws !== closing && ws.readyState === WebSocket.OPEN);
    const message = JSON.stringify({ type: 'devices', count: open.length } satisfies ServerMessage);
    for (const ws of open) {
      try {
        ws.send(message);
      } catch {
        // ignore
      }
    }
  }
}
