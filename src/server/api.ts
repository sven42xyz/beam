import { generateCode, normalizeCode } from '../shared/codes';
import { MAX_CIPHERTEXT_CHARS, MAX_ENC_META_CHARS, MAX_FILE_BYTES, MAX_TEXT_BYTES } from '../shared/limits';
import type { RoomError } from './room';

const json = (data: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

const error = (status: number, code: string, message: string) => json({ error: code, message }, status);

function roomError(e: RoomError): Response {
  switch (e) {
    case 'room_full':
      return error(409, 'room_full', 'Room is full (max. 50 items).');
    case 'wrong_mode':
      return error(409, 'wrong_mode', 'Encryption mode does not match this room.');
    default:
      return error(404, 'not_found', 'Room not found or expired.');
  }
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

export function roomStub(env: Env, code: string) {
  return env.ROOM.get(env.ROOM.idFromName(code));
}

function clientIp(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

async function rateLimited(limiter: RateLimit, request: Request): Promise<Response | null> {
  const { success } = await limiter.limit({ key: clientIp(request) });
  return success ? null : error(429, 'rate_limited', 'Zu viele Anfragen. Bitte kurz warten.');
}

function isLink(text: string): boolean {
  if (/\s/.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function sanitizeFilename(raw: string | null): string {
  let name = 'datei';
  if (raw) {
    try {
      name = decodeURIComponent(raw);
    } catch {
      name = raw;
    }
  }
  // Pfadanteile und Steuerzeichen entfernen
  name = name.split(/[/\\]/).pop()!.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return name.slice(0, 200) || 'datei';
}

// ---------- Handler ----------

/**
 * Prüft das Turnstile-Token. Ohne konfigurierte Keys (Site Key + Secret) ist Turnstile deaktiviert.
 * Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
async function verifyTurnstile(env: Env, token: unknown, ip: string): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret || !env.TURNSTILE_SITE_KEY) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;

  const body = new FormData();
  body.append('secret', secret);
  body.append('response', token);
  body.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
    const outcome = (await res.json()) as { success: boolean; action?: string; 'error-codes'?: string[] };
    if (!outcome.success) console.warn('turnstile rejected', outcome['error-codes']);
    return outcome.success && (outcome.action === undefined || outcome.action === 'create_room');
  } catch (e) {
    console.error('turnstile verify failed', e);
    return false;
  }
}

async function createRoom(request: Request, env: Env) {
  const limited = await rateLimited(env.RL_CREATE, request);
  if (limited) return limited;

  let body: { turnstileToken?: unknown; encrypted?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // leerer Body ist ok, solange Turnstile nicht aktiv ist
  }
  if (!(await verifyTurnstile(env, body.turnstileToken, clientIp(request)))) {
    return error(403, 'captcha_failed', 'Turnstile verification failed.');
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode();
    if (await roomStub(env, code).init(code, body.encrypted === true)) return json({ code }, 201);
  }
  return error(503, 'no_code', 'Konnte keinen freien Code finden. Bitte erneut versuchen.');
}

async function postText(request: Request, env: Env, code: string) {
  const limited = await rateLimited(env.RL_WRITE, request);
  if (limited) return limited;

  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > MAX_CIPHERTEXT_CHARS + 1024) return error(413, 'too_large', 'Text ist zu lang (max. 100 KB).');

  let body: { text?: unknown; ciphertext?: unknown };
  try {
    body = await request.json();
  } catch {
    return error(400, 'bad_request', 'Ungültiger JSON-Body.');
  }
  // Verschlüsselter Raum: Chiffretext unverändert speichern, der Server kann ihn nicht lesen
  if (typeof body.ciphertext === 'string') {
    const ciphertext = body.ciphertext;
    if (!ciphertext || !BASE64URL.test(ciphertext)) return error(400, 'bad_request', 'Invalid ciphertext.');
    if (ciphertext.length > MAX_CIPHERTEXT_CHARS) return error(413, 'too_large', 'Text ist zu lang (max. 100 KB).');
    const result = await roomStub(env, code).addText({ ciphertext });
    return result.ok ? json(result.value, 201) : roomError(result.error);
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return error(400, 'empty', 'Text ist leer.');
  if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
    return error(413, 'too_large', 'Text ist zu lang (max. 100 KB).');
  }

  const result = await roomStub(env, code).addText({ text, kind: isLink(text) ? 'link' : 'text' });
  return result.ok ? json(result.value, 201) : roomError(result.error);
}

async function uploadFile(request: Request, env: Env, code: string) {
  const limited = await rateLimited(env.RL_WRITE, request);
  if (limited) return limited;

  const lengthHeader = request.headers.get('Content-Length');
  if (!lengthHeader || !request.body) return error(411, 'length_required', 'Content-Length fehlt.');
  const size = Number(lengthHeader);
  if (!Number.isSafeInteger(size) || size < 0) return error(400, 'bad_request', 'Ungültige Content-Length.');
  if (size > MAX_FILE_BYTES) return error(413, 'too_large', 'Datei ist zu groß (max. 100 MB).');

  // Verschlüsselt: X-Filename enthält Chiffretext (Name, Typ, Originalgröße), der Inhalt ist opak
  const encrypted = request.headers.get('X-Encrypted') === '1';
  let name: string;
  let mime: string;
  if (encrypted) {
    name = request.headers.get('X-Filename') ?? '';
    if (!BASE64URL.test(name) || name.length > MAX_ENC_META_CHARS) return error(400, 'bad_request', 'Invalid metadata.');
    mime = 'application/octet-stream';
  } else {
    name = sanitizeFilename(request.headers.get('X-Filename'));
    mime = request.headers.get('Content-Type')?.split(';')[0].trim() || 'application/octet-stream';
  }

  const stub = roomStub(env, code);
  const reserved = await stub.reserveFile(name, size, mime, encrypted);
  if (!reserved.ok) return roomError(reserved.error);
  const { id, r2Key } = reserved.value;

  try {
    // FixedLengthStream erzwingt, dass genau `size` Bytes ankommen (R2 braucht eine bekannte Länge)
    const { readable, writable } = new FixedLengthStream(size);
    await Promise.all([
      request.body.pipeTo(writable),
      env.FILES.put(r2Key, readable, { httpMetadata: { contentType: mime } }),
    ]);
  } catch (e) {
    await stub.abortFile(id);
    console.error('upload failed', e);
    return error(400, 'upload_failed', 'Upload fehlgeschlagen.');
  }

  const committed = await stub.commitFile(id);
  if (!committed.ok) {
    await env.FILES.delete(r2Key);
    return roomError(committed.error);
  }
  return json(committed.value, 201);
}

async function downloadFile(env: Env, code: string, id: string) {
  const meta = await roomStub(env, code).getFile(id);
  if (!meta) return error(404, 'not_found', 'Datei nicht gefunden.');
  const object = await env.FILES.get(meta.r2Key);
  if (!object) return error(404, 'not_found', 'Datei nicht gefunden.');

  return new Response(object.body, {
    headers: {
      'Content-Type': meta.mime,
      'Content-Length': String(object.size),
      // Verschlüsselte Dateien entschlüsselt der Browser selbst und vergibt dabei den echten Namen
      'Content-Disposition': meta.encrypted ? 'attachment; filename="tee-encrypted.bin"' : contentDisposition(meta.name),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function deleteItem(request: Request, env: Env, code: string, id: string) {
  const limited = await rateLimited(env.RL_WRITE, request);
  if (limited) return limited;
  const deleted = await roomStub(env, code).deleteItem(id);
  return deleted ? new Response(null, { status: 204 }) : error(404, 'not_found', 'Eintrag nicht gefunden.');
}

// ---------- Router ----------

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;

  if (pathname === '/api/rooms') {
    return method === 'POST' ? createRoom(request, env) : error(405, 'method_not_allowed', 'Method not allowed');
  }

  const match = pathname.match(/^\/api\/rooms\/([^/]+)(?:\/(ws|text|files|items)(?:\/([0-9a-f-]{36}))?)?$/i);
  if (!match) return error(404, 'not_found', 'Not found');

  const code = normalizeCode(match[1]);
  if (!code) return error(404, 'not_found', 'Raum nicht gefunden oder abgelaufen.');
  const [, , action, id] = match;

  switch (`${method} ${action ?? ''}${id ? '/:id' : ''}`) {
    case 'GET ':
      return (await roomStub(env, code).exists())
        ? json({ code })
        : error(404, 'not_found', 'Raum nicht gefunden oder abgelaufen.');
    case 'GET ws':
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return error(426, 'upgrade_required', 'WebSocket erwartet.');
      }
      return roomStub(env, code).fetch(request);
    case 'POST text':
      return postText(request, env, code);
    case 'POST files':
      return uploadFile(request, env, code);
    case 'GET files/:id':
      return downloadFile(env, code, id!.toLowerCase());
    case 'DELETE items/:id':
      return deleteItem(request, env, code, id!.toLowerCase());
    default:
      return error(405, 'method_not_allowed', 'Method not allowed');
  }
}
