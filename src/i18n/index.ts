import { MAX_FILE_BYTES, MAX_ITEMS } from '../shared/limits';

export const LANGS = ['de', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';
export const LANG_COOKIE = 'lang';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** Cookie hat Vorrang, sonst Accept-Language (nach q-Wert sortiert), sonst Englisch. */
export function pickLang(cookie: string | undefined, acceptLanguage: string | null): Lang {
  if (isLang(cookie)) return cookie;
  const prefs = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = Number(params.find((p) => p.trim().startsWith('q='))?.split('=')[1] ?? 1);
      return { lang: tag.toLowerCase().split('-')[0], q: Number.isNaN(q) ? 0 : q };
    })
    .filter((p) => p.lang)
    .sort((a, b) => b.q - a.q);
  return prefs.map((p) => p.lang).find(isLang) ?? DEFAULT_LANG;
}

const maxMb = MAX_FILE_BYTES / 1024 / 1024;

const de = {
  meta: {
    title: 'Beam – Text & Dateien zwischen Geräten teilen',
    description: 'Text, Links und Dateien schnell zwischen Geräten austauschen – ohne Login.',
  },
  nav: {
    github: 'GitHub',
    language: 'Sprache',
  },
  home: {
    eyebrow: 'Handy ⇄ Laptop',
    headline: 'Vom einen Gerät aufs andere.',
    headlineAccent: 'In Sekunden.',
    lead: 'Text, Links und Dateien schnell zwischen deinen Geräten austauschen, ohne Login, ohne App und ohne dir selbst Mails zu schicken.',
    create: 'Raum erstellen',
    orEnterCode: 'oder Code eingeben',
    codeLabel: 'Raum-Code',
    join: 'Beitreten',
    note: 'Räume löschen sich 24 h nach der letzten Aktivität.',
    howTitle: "So funktioniert's",
    steps: [
      { title: 'Raum erstellen', text: 'Ein Klick und du hast einen kurzen Code und einen QR-Code.' },
      {
        title: 'Zweites Gerät verbinden',
        text: 'QR-Code scannen oder den Code eingeben. Eine App oder ein Konto brauchst du nicht.',
      },
      { title: 'Teilen', text: 'Text, Links und Dateien tauchen sofort auf allen verbundenen Geräten auf.' },
    ],
    featuresTitle: 'Was Beam kann',
    features: {
      live: { title: 'Live-Sync', text: 'Neue Einträge erscheinen ohne Neuladen auf allen Geräten im Raum.' },
      file: { title: `Dateien bis ${maxMb} MB`, text: 'Per Auswahl, Drag & Drop oder direkt aus der Zwischenablage.' },
      key: { title: 'Kein Login', text: 'Keine Accounts, keine Installation. Der Code ist dein Zugang.' },
      clock: { title: 'Löscht sich selbst', text: '24 Stunden nach der letzten Aktivität ist alles weg, auch die Dateien.' },
      copy: { title: 'Ein Klick', text: 'Text mit einem Klick kopieren, Dateien mit einem Klick laden.' },
      code: { title: 'Open Source', text: 'Der komplette Code liegt auf GitHub.' },
    },
    faqTitle: 'Häufige Fragen',
    faq: [
      {
        q: 'Wer kann meine Inhalte sehen?',
        a: 'Alle, die den Raum-Code kennen. Teile ihn also nur mit deinen eigenen Geräten oder Leuten, denen du vertraust. Die Verbindung ist per HTTPS verschlüsselt, die Inhalte selbst liegen aber unverschlüsselt auf den Servern. Für vertrauliche Dokumente ist Beam nicht gedacht.',
      },
      {
        q: 'Wie lange bleiben die Daten gespeichert?',
        a: '24 Stunden nach der letzten Aktivität im Raum werden der Raum und alle Dateien automatisch gelöscht. Einzelne Einträge kannst du jederzeit selbst löschen.',
      },
      {
        q: 'Gibt es Limits?',
        a: `Pro Datei maximal ${maxMb} MB und pro Raum maximal ${MAX_ITEMS} Einträge. Damit niemand den Dienst überlastet, ist auch die Anzahl der Anfragen pro Minute begrenzt.`,
      },
      { q: 'Brauche ich eine App?', a: 'Nein. Beam läuft in jedem aktuellen Browser, auf dem Handy genauso wie am Laptop.' },
      { q: 'Was kostet das?', a: 'Nichts. Beam ist ein kleines Open-Source-Projekt ohne Werbung und ohne Tracking.' },
    ],
    ctaTitle: 'Bereit?',
    footer: 'Beam · Open Source',
    support: 'Unterstützen',
  },
  room: {
    titleNotFound: 'Raum nicht gefunden',
    notFound: 'Raum nicht gefunden',
    notFoundText: 'Der Code ist ungültig oder der Raum ist abgelaufen (24 h ohne Aktivität).',
    toHome: 'Zur Startseite',
    homeLabel: 'Beam Startseite',
    roomCode: 'Raum-Code',
    copyLink: 'Link kopieren',
    qr: 'QR-Code',
    qrLabel: 'QR-Code zum Raum',
    textLabel: 'Text oder Link',
    placeholder: 'Text oder Link einfügen…',
    file: 'Datei',
    dropHint: 'oder hierher ziehen',
    send: 'Senden',
    items: 'Einträge',
    empty: 'Noch nichts hier. Schick etwas von einem beliebigen Gerät.',
    dropzone: 'Dateien loslassen zum Senden',
    // Client
    linkCopied: 'Link kopiert',
    copied: 'Kopiert',
    copy: 'Kopieren',
    download: 'Herunterladen',
    delete: 'Löschen',
    deleteItem: 'Eintrag löschen',
    connecting: 'Verbinde…',
    reconnecting: 'Offline – verbinde neu…',
    expired: 'Raum abgelaufen',
    devices: (n: number) => (n === 1 ? '1 Gerät' : `${n} Geräte`),
    expiresAt: (date: string) => `Raum wird gelöscht am ${date} (24 h nach letzter Aktivität).`,
    fileTooLarge: (name: string, max: string) => `„${name}“ ist zu groß (max. ${max})`,
  },
  errors: {
    not_found: 'Raum nicht gefunden oder abgelaufen.',
    room_full: `Der Raum ist voll (max. ${MAX_ITEMS} Einträge).`,
    too_large: 'Zu groß.',
    rate_limited: 'Zu viele Anfragen. Bitte kurz warten.',
    empty: 'Text ist leer.',
    upload_failed: 'Upload fehlgeschlagen.',
    captcha_failed: 'Sicherheitsprüfung fehlgeschlagen. Bitte Seite neu laden und erneut versuchen.',
    network: 'Netzwerkfehler',
    invalidCode: 'Ungültiger Code – 6 Zeichen, z. B. ABC234.',
    createFailed: 'Fehler beim Erstellen.',
    sendFailed: 'Senden fehlgeschlagen',
    generic: (status: number) => `Fehler ${status}`,
  },
};

export type Dict = typeof de;

const en: Dict = {
  meta: {
    title: 'Beam – Share text & files between devices',
    description: 'Quickly move text, links and files between your devices – no login.',
  },
  nav: {
    github: 'GitHub',
    language: 'Language',
  },
  home: {
    eyebrow: 'Phone ⇄ Laptop',
    headline: 'From one device to another.',
    headlineAccent: 'In seconds.',
    lead: 'Move text, links and files between your devices in no time. No login, no app, no emailing yourself.',
    create: 'Create room',
    orEnterCode: 'or enter a code',
    codeLabel: 'Room code',
    join: 'Join',
    note: 'Rooms delete themselves 24 h after the last activity.',
    howTitle: 'How it works',
    steps: [
      { title: 'Create a room', text: 'One click gets you a short code and a QR code.' },
      { title: 'Connect a second device', text: 'Scan the QR code or type in the code. No app, no account.' },
      { title: 'Share', text: 'Text, links and files show up instantly on every connected device.' },
    ],
    featuresTitle: 'What Beam does',
    features: {
      live: { title: 'Live sync', text: 'New items appear on every device in the room without reloading.' },
      file: { title: `Files up to ${maxMb} MB`, text: 'Pick them, drag & drop them or paste them from the clipboard.' },
      key: { title: 'No login', text: 'No accounts, nothing to install. The code is your key.' },
      clock: { title: 'Self-destructing', text: '24 hours after the last activity everything is gone, files included.' },
      copy: { title: 'One click', text: 'Copy text with one click, download files with one click.' },
      code: { title: 'Open source', text: 'All of the code is on GitHub.' },
    },
    faqTitle: 'FAQ',
    faq: [
      {
        q: 'Who can see my content?',
        a: 'Anyone who knows the room code. Only share it with your own devices or people you trust. The connection is encrypted via HTTPS, but the content itself is stored unencrypted on the servers. Beam is not meant for confidential documents.',
      },
      {
        q: 'How long is data kept?',
        a: '24 hours after the last activity in a room, the room and all its files are deleted automatically. You can delete individual items yourself at any time.',
      },
      {
        q: 'Are there limits?',
        a: `Up to ${maxMb} MB per file and ${MAX_ITEMS} items per room. The number of requests per minute is limited too, so nobody can overload the service.`,
      },
      { q: 'Do I need an app?', a: 'No. Beam runs in any modern browser, on your phone just like on your laptop.' },
      { q: 'What does it cost?', a: 'Nothing. Beam is a small open-source project without ads or tracking.' },
    ],
    ctaTitle: 'Ready?',
    footer: 'Beam · Open source',
    support: 'Support',
  },
  room: {
    titleNotFound: 'Room not found',
    notFound: 'Room not found',
    notFoundText: 'The code is invalid or the room has expired (24 h without activity).',
    toHome: 'Back to start',
    homeLabel: 'Beam home',
    roomCode: 'Room code',
    copyLink: 'Copy link',
    qr: 'QR code',
    qrLabel: 'QR code for this room',
    textLabel: 'Text or link',
    placeholder: 'Paste text or a link…',
    file: 'File',
    dropHint: 'or drop it here',
    send: 'Send',
    items: 'Items',
    empty: 'Nothing here yet. Send something from any device.',
    dropzone: 'Drop files to send',
    linkCopied: 'Link copied',
    copied: 'Copied',
    copy: 'Copy',
    download: 'Download',
    delete: 'Delete',
    deleteItem: 'Delete item',
    connecting: 'Connecting…',
    reconnecting: 'Offline – reconnecting…',
    expired: 'Room expired',
    devices: (n: number) => (n === 1 ? '1 device' : `${n} devices`),
    expiresAt: (date: string) => `Room will be deleted on ${date} (24 h after the last activity).`,
    fileTooLarge: (name: string, max: string) => `“${name}” is too large (max. ${max})`,
  },
  errors: {
    not_found: 'Room not found or expired.',
    room_full: `This room is full (max. ${MAX_ITEMS} items).`,
    too_large: 'Too large.',
    rate_limited: 'Too many requests. Please wait a moment.',
    empty: 'Text is empty.',
    upload_failed: 'Upload failed.',
    captcha_failed: 'Security check failed. Please reload the page and try again.',
    network: 'Network error',
    invalidCode: 'Invalid code – 6 characters, e.g. ABC234.',
    createFailed: 'Could not create a room.',
    sendFailed: 'Sending failed',
    generic: (status: number) => `Error ${status}`,
  },
};

const DICTS: Record<Lang, Dict> = { de, en };

export function useTranslations(lang: Lang): Dict {
  return DICTS[lang];
}

/** Übersetzt einen API-Fehlercode (`{ error: "room_full" }`) für die Anzeige. */
export function apiErrorMessage(t: Dict, code: string | undefined, status: number): string {
  if (code && code in t.errors) {
    const msg = t.errors[code as keyof Dict['errors']];
    if (typeof msg === 'string') return msg;
  }
  return t.errors.generic(status);
}
