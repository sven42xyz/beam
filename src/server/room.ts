import { DurableObject } from 'cloudflare:workers';
import { MAX_ITEMS, PENDING_TIMEOUT_MS, ROOM_TTL_MS } from '../shared/limits';
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

export type RoomError = 'not_found' | 'room_full';
export type Result<T> = { ok: true; value: T } | { ok: false; error: RoomError };

function toItem(row: ItemRow): Item {
  if (row.kind === 'file') {
    return {
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at,
      name: row.file_name ?? 'datei',
      size: row.file_size ?? 0,
      mime: row.mime ?? 'application/octet-stream',
    };
  }
  return { id: row.id, kind: row.kind, createdAt: row.created_at, content: row.content ?? '' };
}

/**
 * Ein Raum = ein Durable Object (SQLite-backed).
 * Live-Sync über die WebSocket Hibernation API, Aufräumen über einen Alarm.
 */
export class Room extends DurableObject<Env> {
  private sql: SqlStorage;
  /** Schema wird erst in init() angelegt, damit Aufrufe unbekannter Codes keinen Storage hinterlassen. */
  private hasSchema: boolean;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.hasSchema =
      this.sql.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`).toArray().length > 0;
    // Antwortet auf "ping" ohne das DO aus dem Hibernation-Zustand zu wecken
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

  /** Aktivität: Ablaufzeit auf jetzt + 24 h verschieben. */
  private async touch(): Promise<number> {
    const now = Date.now();
    const expiresAt = now + ROOM_TTL_MS;
    this.setMeta('last_activity', String(now));
    await this.ctx.storage.setAlarm(expiresAt);
    return expiresAt;
  }

  // ---------- RPC ----------

  /** Legt den Raum an. false, wenn der Code schon vergeben ist. */
  async init(code: string): Promise<boolean> {
    if (this.code) return false;
    this.createSchema();
    this.setMeta('code', code);
    this.setMeta('created_at', String(Date.now()));
    await this.touch();
    return true;
  }

  exists(): boolean {
    return this.code !== null;
  }

  async addText(content: string, kind: 'text' | 'link'): Promise<Result<Item>> {
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
    const item = toItem(row);
    this.broadcast({ type: 'item', item, expiresAt: await this.touch() });
    return { ok: true, value: item };
  }

  /** Reserviert einen Platz für einen Upload. Der Eintrag ist bis commitFile() unsichtbar. */
  async reserveFile(name: string, size: number, mime: string): Promise<Result<{ id: string; r2Key: string }>> {
    const code = this.code;
    if (!code) return { ok: false, error: 'not_found' };
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
    await this.touch();
    return { ok: true, value: { id, r2Key } };
  }

  async commitFile(id: string): Promise<Result<Item>> {
    if (!this.code) return { ok: false, error: 'not_found' };
    this.sql.exec(`UPDATE items SET status = 'ready', created_at = ? WHERE id = ? AND status = 'pending'`, Date.now(), id);
    const row = this.getRow(id);
    if (!row || row.status !== 'ready') return { ok: false, error: 'not_found' };
    const item = toItem(row);
    this.broadcast({ type: 'item', item, expiresAt: await this.touch() });
    return { ok: true, value: item };
  }

  async abortFile(id: string): Promise<void> {
    const row = this.getRow(id);
    if (!row || row.status !== 'pending') return;
    this.sql.exec('DELETE FROM items WHERE id = ?', id);
    if (row.r2_key) await this.env.FILES.delete(row.r2_key);
  }

  getFile(id: string): { r2Key: string; name: string; size: number; mime: string } | null {
    const row = this.getRow(id);
    if (!row || row.kind !== 'file' || row.status !== 'ready' || !row.r2_key) return null;
    return {
      r2Key: row.r2_key,
      name: row.file_name ?? 'datei',
      size: row.file_size ?? 0,
      mime: row.mime ?? 'application/octet-stream',
    };
  }

  async deleteItem(id: string): Promise<boolean> {
    const row = this.getRow(id);
    if (!row || row.status !== 'ready') return false;
    this.sql.exec('DELETE FROM items WHERE id = ?', id);
    if (row.r2_key) await this.env.FILES.delete(row.r2_key);
    this.broadcast({ type: 'delete', id, expiresAt: await this.touch() });
    return true;
  }

  // ---------- WebSockets (Hibernation API) ----------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    if (!this.code) return new Response('Room not found', { status: 404 });

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    const expiresAt = await this.touch();
    const devices = this.ctx.getWebSockets().length;
    server.send(JSON.stringify({ type: 'init', items: this.listItems(), devices, expiresAt } satisfies ServerMessage));
    this.broadcast({ type: 'devices', count: devices }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer) {
    // Clients senden nur "ping" (per Auto-Response beantwortet). Alles andere läuft über HTTP.
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      // bereits geschlossen
    }
    this.broadcastDeviceCount(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.broadcastDeviceCount(ws);
  }

  // ---------- Alarm: Raum nach 24 h Inaktivität löschen ----------

  async alarm() {
    const lastActivity = Number(this.getMeta('last_activity') ?? 0);
    if (lastActivity && Date.now() < lastActivity + ROOM_TTL_MS) {
      // Zwischenzeitlich Aktivität: neu planen
      await this.ctx.storage.setAlarm(lastActivity + ROOM_TTL_MS);
      return;
    }

    const code = this.code;
    if (code) await this.deleteR2Prefix(`rooms/${code}/`);

    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(4404, 'Room expired');
      } catch {
        // ignorieren
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.hasSchema = false;
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

  /** Zählt auch laufende Uploads mit, damit parallele Uploads das Limit nicht überschreiten. */
  private countItems(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM items').one().n;
  }

  private listItems(): Item[] {
    return this.sql
      .exec<ItemRow>(`SELECT * FROM items WHERE status = 'ready' ORDER BY created_at DESC`)
      .toArray()
      .map(toItem);
  }

  private async cleanupStalePending() {
    const cutoff = Date.now() - PENDING_TIMEOUT_MS;
    const stale = this.sql
      .exec<{ id: string; r2_key: string | null }>(
        `SELECT id, r2_key FROM items WHERE status = 'pending' AND created_at < ?`,
        cutoff,
      )
      .toArray();
    if (stale.length === 0) return;
    this.sql.exec(`DELETE FROM items WHERE status = 'pending' AND created_at < ?`, cutoff);
    const keys = stale.map((s) => s.r2_key).filter((k): k is string => !!k);
    if (keys.length) await this.env.FILES.delete(keys);
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
        // Socket schließt gerade
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
        // ignorieren
      }
    }
  }
}
