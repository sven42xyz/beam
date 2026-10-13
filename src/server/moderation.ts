import { DurableObject } from 'cloudflare:workers';
import { EmailMessage } from 'cloudflare:email';
import type { ReportCategory } from '../shared/moderation';

/** Reports are kept as a record of what was reported and done, then deleted. */
const REPORT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
/** How long the admin link in a report email stays valid. */
export const ADMIN_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface Report {
  id: string;
  createdAt: number;
  code: string;
  itemId: string | null;
  category: ReportCategory;
  description: string;
  contact: string | null;
  /** The room was blocked automatically because of this report */
  autoBlocked: boolean;
}

type ReportRow = {
  id: string;
  created_at: number;
  code: string;
  item_id: string | null;
  category: ReportCategory;
  description: string;
  contact: string | null;
  auto_blocked: number;
};

/**
 * Single Durable Object (`idFromName('global')`) that keeps the reports received
 * through the "report content" form, as documentation of the notice-and-action
 * process (DSA Art. 16). Rows are deleted after 180 days.
 */
export class Moderation extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        code TEXT NOT NULL,
        item_id TEXT,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        contact TEXT,
        auto_blocked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS reports_code ON reports (code);
    `);
  }

  async addReport(report: Omit<Report, 'id' | 'createdAt'>): Promise<Report> {
    const full: Report = { ...report, id: crypto.randomUUID(), createdAt: Date.now() };
    this.sql.exec(
      `INSERT INTO reports (id, created_at, code, item_id, category, description, contact, auto_blocked)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      full.id,
      full.createdAt,
      full.code,
      full.itemId,
      full.category,
      full.description,
      full.contact,
      full.autoBlocked ? 1 : 0,
    );
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    }
    return full;
  }

  reportsFor(code: string): Report[] {
    return this.sql
      .exec<ReportRow>('SELECT * FROM reports WHERE code = ? ORDER BY created_at DESC', code)
      .toArray()
      .map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        code: r.code,
        itemId: r.item_id,
        category: r.category,
        description: r.description,
        contact: r.contact,
        autoBlocked: r.auto_blocked === 1,
      }));
  }

  async alarm() {
    this.sql.exec('DELETE FROM reports WHERE created_at < ?', Date.now() - REPORT_RETENTION_MS);
    await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
  }
}

export function moderationStub(env: Env) {
  return env.MODERATION.get(env.MODERATION.idFromName('global'));
}

// ---------- Signed admin links ----------

const toBase64Url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Signature over room code and expiry. Whoever holds the link may moderate that one room until `exp`. */
export async function signAdmin(env: Env, code: string, exp: number): Promise<string> {
  if (!env.ADMIN_SECRET) throw new Error('ADMIN_SECRET is not configured');
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env.ADMIN_SECRET), new TextEncoder().encode(`${code}.${exp}`));
  return toBase64Url(sig);
}

export async function verifyAdmin(env: Env, code: string, exp: number, sig: string): Promise<boolean> {
  if (!env.ADMIN_SECRET || !Number.isFinite(exp) || exp < Date.now() || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return false;
  const raw = Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/') + '='), (c) => c.charCodeAt(0));
  // crypto.subtle.verify compares in constant time
  return crypto.subtle.verify('HMAC', await hmacKey(env.ADMIN_SECRET), raw, new TextEncoder().encode(`${code}.${exp}`));
}

export async function adminUrl(env: Env, origin: string, code: string): Promise<string> {
  const exp = Date.now() + ADMIN_LINK_TTL_MS;
  return `${origin}/admin/${code}?exp=${exp}&sig=${await signAdmin(env, code, exp)}`;
}

// ---------- Notification email ----------

const CATEGORY_LABELS: Record<ReportCategory, string> = {
  csam: 'Darstellung sexuellen Missbrauchs von Kindern',
  violence: 'Gewalt, Terror oder Hass',
  copyright: 'Urheberrechtsverletzung',
  malware: 'Schadsoftware oder Phishing',
  personal: 'Persönliche Daten ohne Einwilligung',
  other: 'Sonstiges',
};

/** RFC 2047 encoded-word, so umlauts in the subject survive. */
const encodeHeader = (text: string) =>
  `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}?=`;

function mime(from: string, to: string, subject: string, body: string): string {
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(body)))
    .match(/.{1,76}/g)!
    .join('\r\n');
  return [
    `From: tee <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64,
  ].join('\r\n');
}

/** Notifies the operator about a new report. Failing to send never fails the report itself. */
export async function sendReportMail(
  env: Env,
  report: Report,
  room: { encrypted: boolean },
  link: string,
): Promise<boolean> {
  if (!env.REPORT_TO) return false;
  const from = 'tee@chapter42.de';
  const subject = `[tee] Meldung: ${CATEGORY_LABELS[report.category]} – Raum ${report.code}`;
  const lines = [
    `Neue Meldung für Raum ${report.code}`,
    '',
    `Kategorie:      ${CATEGORY_LABELS[report.category]}`,
    `Eingegangen:    ${new Date(report.createdAt).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}`,
    `Raum:           ${room.encrypted ? 'Ende-zu-Ende verschlüsselt (Inhalt für dich nicht lesbar)' : 'unverschlüsselt'}`,
    `Eintrag:        ${report.itemId ?? '(nicht angegeben)'}`,
    `Kontakt:        ${report.contact ?? '(anonym)'}`,
    `Status:         ${report.autoBlocked ? 'Raum wurde AUTOMATISCH GESPERRT' : 'Raum ist weiter erreichbar'}`,
    `Meldungs-ID:    ${report.id}`,
    '',
    'Beschreibung:',
    report.description,
    '',
    `Raum sperren, entsperren oder löschen (Link gültig 14 Tage):`,
    link,
    '',
  ];
  if (report.category === 'csam') {
    lines.push(
      'WICHTIG bei Missbrauchsdarstellungen:',
      '- Inhalte NICHT öffnen oder herunterladen.',
      '- Raum über den Link oben löschen.',
      '- Meldung an die Polizei bzw. das BKA oder an jugendschutz.net weitergeben',
      '  (Raum-Code und Zeitpunkt, keine Inhalte). Ablauf: docs/abuse.md im Repo.',
      '',
    );
  }
  try {
    await env.REPORT_MAIL.send(new EmailMessage(from, env.REPORT_TO, mime(from, env.REPORT_TO, subject, lines.join('\n'))));
    return true;
  } catch (e) {
    console.error('report mail failed', e);
    return false;
  }
}
