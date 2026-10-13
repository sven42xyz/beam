import { IP_DAILY_UPLOAD_BYTES, MAX_FILE_BYTES, MAX_ITEMS } from '../shared/limits';

export const LANGS = ['de', 'en'] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = 'en';
export const LANG_COOKIE = 'lang';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value);
}

/** The cookie wins, then Accept-Language (sorted by q value), then English. */
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
const dailyGb = IP_DAILY_UPLOAD_BYTES / 1000 ** 3;

const de = {
  meta: {
    title: 'tee – Text & Dateien zwischen Geräten teilen',
    description: 'Text, Links und Dateien schnell zwischen Geräten austauschen – ohne Login.',
    ogImageAlt: 'tee: Eine Datei fliegt als Funke vom Handy zum Laptop. Vom einen Gerät aufs andere. In Sekunden.',
  },
  nav: {
    github: 'GitHub',
    language: 'Sprache',
  },
  a11y: {
    skipToContent: 'Zum Inhalt springen',
  },
  legal: {
    terms: 'Nutzungsbedingungen',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    termsNoteBefore: 'Mit dem Erstellen akzeptierst du die ',
    termsNoteAfter: '.',
  },
  home: {
    headline: 'Vom einen Gerät aufs andere.',
    headlineAccent: 'In Sekunden.',
    lead: 'Text, Links und Dateien schnell zwischen deinen Geräten austauschen, ohne Login, ohne App und ohne dir selbst Mails zu schicken.',
    create: 'Raum erstellen',
    encryptLabel: 'Ende-zu-Ende verschlüsselt',
    encryptOnHint: 'Zweites Gerät per QR-Code oder Link verbinden.',
    encryptOffHint: 'Unverschlüsselt: Der Code allein reicht zum Beitreten.',
    orEnterCode: 'oder Code eingeben',
    codeLabel: 'Raum-Code',
    join: 'Beitreten',
    note: 'Räume löschen sich 24 h nach der letzten Aktivität, spätestens nach 7 Tagen.',
    howTitle: "So funktioniert's",
    steps: [
      { title: 'Raum erstellen', text: 'Ein Klick und du hast einen kurzen Code und einen QR-Code.' },
      {
        title: 'Zweites Gerät verbinden',
        text: 'QR-Code scannen oder den Code eingeben. Eine App oder ein Konto brauchst du nicht.',
      },
      { title: 'Teilen', text: 'Text, Links und Dateien tauchen sofort auf allen verbundenen Geräten auf.' },
    ],
    featuresTitle: 'Was tee kann',
    features: {
      live: { title: 'Live-Sync', text: 'Neue Einträge erscheinen ohne Neuladen auf allen Geräten im Raum.' },
      file: { title: `Dateien bis ${maxMb} MB`, text: 'Per Auswahl, Drag & Drop oder direkt aus der Zwischenablage.' },
      key: { title: 'Kein Login', text: 'Keine Accounts, keine Installation. Der Code ist dein Zugang.' },
      clock: { title: 'Löscht sich selbst', text: '24 Stunden nach der letzten Aktivität ist alles weg, auch die Dateien. Spätestens nach 7 Tagen.' },
      lock: { title: 'Ende-zu-Ende verschlüsselt', text: 'Inhalte werden auf deinem Gerät verschlüsselt. Der Server sieht nur Datensalat.' },
      code: { title: 'Open Source', text: 'Der komplette Code liegt auf GitHub.' },
    },
    faqTitle: 'Häufige Fragen',
    faq: [
      {
        q: 'Wer kann meine Inhalte sehen?',
        a: 'Standardmäßig nur die Geräte, die den Raum über den QR-Code oder Link geöffnet haben. Texte, Links, Dateien und Dateinamen werden Ende-zu-Ende verschlüsselt, der Schlüssel steckt im Link und erreicht nie den Server. Auch der Betreiber kann die Inhalte nicht lesen. Sichtbar sind nur Anzahl, Größe und Zeitpunkt der Einträge. Wer beim Erstellen „Ende-zu-Ende verschlüsselt“ abwählt, bekommt einen Raum, dem man nur mit dem Code beitreten kann. Dessen Inhalte liegen unverschlüsselt auf dem Server und sind für alle sichtbar, die den Code kennen.',
      },
      {
        q: 'Wie lange bleiben die Daten gespeichert?',
        a: '24 Stunden nach der letzten Aktivität im Raum werden der Raum und alle Dateien automatisch gelöscht, unabhängig davon spätestens 7 Tage nach dem Erstellen. Einzelne Einträge kannst du jederzeit selbst löschen.',
      },
      {
        q: 'Gibt es Limits?',
        a: `Pro Datei maximal ${maxMb} MB und pro Raum maximal ${MAX_ITEMS} Einträge. Damit niemand den Dienst überlastet, sind außerdem die Anfragen pro Minute und das Upload-Volumen pro Tag begrenzt (${dailyGb} GB pro Netz).`,
      },
      { q: 'Brauche ich eine App?', a: 'Nein. tee läuft in jedem aktuellen Browser, auf dem Handy genauso wie am Laptop.' },
      { q: 'Was kostet das?', a: 'Nichts. tee ist ein kleines Open-Source-Projekt ohne Werbung und ohne Tracking.' },
      {
        q: 'Warum heißt das tee?',
        a: 'Nach dem Unix-Befehl tee: Er nimmt einen Datenstrom und verteilt ihn auf mehrere Ausgänge gleichzeitig. Genau das macht ein Raum. Was ein Gerät schickt, kommt auf allen anderen an. Mit Tee zum Trinken hat es nichts zu tun.',
      },
    ],
    ctaTitle: 'Bereit?',
    footer: 'tee · Open Source',
    support: 'Unterstützen',
  },
  room: {
    titleNotFound: 'Raum nicht gefunden',
    notFound: 'Raum nicht gefunden',
    notFoundText: 'Der Code ist ungültig oder der Raum ist abgelaufen (24 h ohne Aktivität).',
    toHome: 'Zur Startseite',
    homeLabel: 'tee Startseite',
    roomCode: 'Raum-Code',
    copyLink: 'Link kopieren',
    copyLinkLabel: (code: string) => `Raum-Code ${code}, Link zum Raum kopieren`,
    heading: (code: string) => `Raum ${code}`,
    announceItem: (what: string) => `Neuer Eintrag: ${what}`,
    announceDeleted: 'Eintrag gelöscht',
    kindText: 'Text',
    kindLink: 'Link',
    report: 'Inhalt melden',
    reportTitle: 'Inhalt melden',
    reportIntro: 'Melde rechtswidrige Inhalte in diesem Raum. Die Meldung geht direkt an den Betreiber, du kannst auch anonym melden.',
    reportCategory: 'Art des Verstoßes',
    reportChoose: 'Bitte auswählen',
    reportCategories: {
      csam: 'Darstellung sexuellen Missbrauchs von Kindern',
      violence: 'Gewalt, Terror oder Hass',
      copyright: 'Urheberrechtsverletzung',
      malware: 'Schadsoftware oder Phishing',
      personal: 'Persönliche Daten ohne Einwilligung',
      other: 'Sonstiges',
    },
    reportItem: 'Betroffener Eintrag (optional)',
    reportItemAll: 'Ganzer Raum / weiß nicht',
    reportDescription: 'Beschreibung',
    reportDescriptionHint: 'Was ist rechtswidrig, und warum?',
    reportContact: 'E-Mail für Rückfragen (optional)',
    reportGoodFaith: 'Ich versichere, dass meine Angaben nach bestem Wissen richtig und vollständig sind.',
    reportSubmit: 'Meldung senden',
    reportCancel: 'Abbrechen',
    reportClose: 'Schließen',
    reportThanks: (id: string) => `Danke, deine Meldung ist eingegangen (Nr. ${id.slice(0, 8)}).`,
    reportBlocked: 'Der Raum wurde vorsorglich gesperrt.',
    reportCsamHint: 'Bitte die Inhalte nicht herunterladen oder weitergeben. Du kannst sie zusätzlich bei der Polizei oder bei jugendschutz.net melden.',
    blockedTitle: 'Dieser Raum wurde gesperrt',
    blockedText: 'Der Raum wurde wegen einer Meldung oder eines Verstoßes gegen die Nutzungsbedingungen gesperrt. Seine Inhalte sind nicht mehr abrufbar.',
    roomBlockedNow: 'Der Raum wurde gesperrt.',
    encryptedBadge: 'Ende-zu-Ende verschlüsselt',
    plainBadge: 'Unverschlüsselt',
    lockedTitle: 'Dieser Raum ist verschlüsselt',
    lockedText: 'Öffne ihn über den QR-Code oder den Link vom anderen Gerät, darin steckt der Schlüssel. Oder füg den Link hier ein:',
    unlockLabel: 'Link zum Raum',
    unlockPlaceholder: 'https://…/ABC234#k=…',
    unlock: 'Öffnen',
    unlockInvalid: 'Das ist kein Link zu diesem Raum mit Schlüssel.',
    decryptFailed: 'Nicht entschlüsselbar',
    decrypting: 'Entschlüssele…',
    encrypting: 'Verschlüssele…',
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
    // Client-side strings
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
    expiresAt: (date: string) => `Raum wird gelöscht am ${date} (24 h nach der letzten Aktivität).`,
    expiresAtFinal: (date: string) => `Raum wird gelöscht am ${date} (7 Tage nach dem Erstellen).`,
    fileTooLarge: (name: string, max: string) => `„${name}“ ist zu groß (max. ${max})`,
  },
  errors: {
    not_found: 'Raum nicht gefunden oder abgelaufen.',
    room_full: `Der Raum ist voll (max. ${MAX_ITEMS} Einträge).`,
    wrong_mode: 'Der Raum wurde inzwischen anders verschlüsselt. Bitte neu laden.',
    room_blocked: 'Dieser Raum wurde gesperrt.',
    storage_full: 'tee ist gerade voll. Bitte versuch es später noch einmal.',
    quota_exceeded: 'Tageslimit für Uploads aus deinem Netz erreicht (2 GB). Morgen geht es weiter.',
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
    title: 'tee – Share text & files between devices',
    description: 'Quickly move text, links and files between your devices – no login.',
    ogImageAlt: 'tee: a file flies as a spark from a phone to a laptop. From one device to another. In seconds.',
  },
  nav: {
    github: 'GitHub',
    language: 'Language',
  },
  a11y: {
    skipToContent: 'Skip to content',
  },
  legal: {
    terms: 'Terms of use',
    imprint: 'Legal notice',
    privacy: 'Privacy',
    termsNoteBefore: 'By creating a room you accept the ',
    termsNoteAfter: '.',
  },
  home: {
    headline: 'From one device to another.',
    headlineAccent: 'In seconds.',
    lead: 'Move text, links and files between your devices in no time. No login, no app, no emailing yourself.',
    create: 'Create room',
    encryptLabel: 'End-to-end encrypted',
    encryptOnHint: 'Connect the second device via QR code or link.',
    encryptOffHint: 'Unencrypted: the code alone is enough to join.',
    orEnterCode: 'or enter a code',
    codeLabel: 'Room code',
    join: 'Join',
    note: 'Rooms delete themselves 24 h after the last activity, after 7 days at the latest.',
    howTitle: 'How it works',
    steps: [
      { title: 'Create a room', text: 'One click gets you a short code and a QR code.' },
      { title: 'Connect a second device', text: 'Scan the QR code or type in the code. No app, no account.' },
      { title: 'Share', text: 'Text, links and files show up instantly on every connected device.' },
    ],
    featuresTitle: 'What tee does',
    features: {
      live: { title: 'Live sync', text: 'New items appear on every device in the room without reloading.' },
      file: { title: `Files up to ${maxMb} MB`, text: 'Pick them, drag & drop them or paste them from the clipboard.' },
      key: { title: 'No login', text: 'No accounts, nothing to install. The code is your key.' },
      clock: { title: 'Self-destructing', text: '24 hours after the last activity everything is gone, files included. After 7 days at the latest.' },
      lock: { title: 'End-to-end encrypted', text: 'Content is encrypted on your device. The server only sees gibberish.' },
      code: { title: 'Open source', text: 'All of the code is on GitHub.' },
    },
    faqTitle: 'FAQ',
    faq: [
      {
        q: 'Who can see my content?',
        a: 'By default, only the devices that opened the room via its QR code or link. Text, links, files and file names are end-to-end encrypted. The key is part of the link and never reaches the server, so not even the operator can read your content. Only the number, size and time of items are visible. If you untick “End-to-end encrypted” when creating a room, it can be joined with the code alone. Its content is stored unencrypted and visible to anyone who knows the code.',
      },
      {
        q: 'How long is data kept?',
        a: '24 hours after the last activity in a room, the room and all its files are deleted automatically, and in any case 7 days after it was created. You can delete individual items yourself at any time.',
      },
      {
        q: 'Are there limits?',
        a: `Up to ${maxMb} MB per file and ${MAX_ITEMS} items per room. To keep anyone from overloading the service, requests per minute and the daily upload volume are limited too (${dailyGb} GB per network).`,
      },
      { q: 'Do I need an app?', a: 'No. tee runs in any modern browser, on your phone just like on your laptop.' },
      { q: 'What does it cost?', a: 'Nothing. tee is a small open-source project without ads or tracking.' },
      {
        q: 'Why is it called tee?',
        a: 'After the Unix command tee: it takes one stream and copies it to several outputs at once. That is exactly what a room does. Whatever one device sends arrives on all the others.',
      },
    ],
    ctaTitle: 'Ready?',
    footer: 'tee · Open source',
    support: 'Support',
  },
  room: {
    titleNotFound: 'Room not found',
    notFound: 'Room not found',
    notFoundText: 'The code is invalid or the room has expired (24 h without activity).',
    toHome: 'Back to start',
    homeLabel: 'tee home',
    roomCode: 'Room code',
    copyLink: 'Copy link',
    copyLinkLabel: (code: string) => `Room code ${code}, copy link to this room`,
    heading: (code: string) => `Room ${code}`,
    announceItem: (what: string) => `New item: ${what}`,
    announceDeleted: 'Item deleted',
    kindText: 'Text',
    kindLink: 'Link',
    report: 'Report content',
    reportTitle: 'Report content',
    reportIntro: 'Report illegal content in this room. The report goes straight to the operator; you can report anonymously.',
    reportCategory: 'Type of violation',
    reportChoose: 'Please choose',
    reportCategories: {
      csam: 'Child sexual abuse material',
      violence: 'Violence, terrorism or hate',
      copyright: 'Copyright infringement',
      malware: 'Malware or phishing',
      personal: 'Personal data without consent',
      other: 'Other',
    },
    reportItem: 'Affected item (optional)',
    reportItemAll: 'Whole room / not sure',
    reportDescription: 'Description',
    reportDescriptionHint: 'What is illegal, and why?',
    reportContact: 'Email for follow-up questions (optional)',
    reportGoodFaith: 'I confirm that the information in this report is accurate and complete to the best of my knowledge.',
    reportSubmit: 'Send report',
    reportCancel: 'Cancel',
    reportClose: 'Close',
    reportThanks: (id: string) => `Thank you, your report has been received (no. ${id.slice(0, 8)}).`,
    reportBlocked: 'The room has been blocked as a precaution.',
    reportCsamHint: 'Please do not download or share the content. You can also report it to the police.',
    blockedTitle: 'This room has been blocked',
    blockedText: 'The room was blocked because of a report or a violation of the terms of use. Its content is no longer available.',
    roomBlockedNow: 'The room has been blocked.',
    encryptedBadge: 'End-to-end encrypted',
    plainBadge: 'Unencrypted',
    lockedTitle: 'This room is encrypted',
    lockedText: 'Open it via the QR code or the link from the other device. The key is part of it. Or paste the link here:',
    unlockLabel: 'Link to this room',
    unlockPlaceholder: 'https://…/ABC234#k=…',
    unlock: 'Open',
    unlockInvalid: 'That is not a link to this room with a key.',
    decryptFailed: 'Could not decrypt',
    decrypting: 'Decrypting…',
    encrypting: 'Encrypting…',
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
    expiresAtFinal: (date: string) => `Room will be deleted on ${date} (7 days after it was created).`,
    fileTooLarge: (name: string, max: string) => `“${name}” is too large (max. ${max})`,
  },
  errors: {
    not_found: 'Room not found or expired.',
    room_full: `This room is full (max. ${MAX_ITEMS} items).`,
    wrong_mode: 'This room uses a different encryption mode. Please reload.',
    room_blocked: 'This room has been blocked.',
    storage_full: 'tee is out of storage right now. Please try again later.',
    quota_exceeded: 'Daily upload limit for your network reached (2 GB). Try again tomorrow.',
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

/** Translates an API error code (`{ error: "room_full" }`) for display. */
export function apiErrorMessage(t: Dict, code: string | undefined, status: number): string {
  if (code && code in t.errors) {
    const msg = t.errors[code as keyof Dict['errors']];
    if (typeof msg === 'string') return msg;
  }
  return t.errors.generic(status);
}
