# tee

**Live:** https://tee.chapter42.de

Text, Links und Dateien schnell zwischen Geräten austauschen (z. B. Handy → Laptop), ohne Login.

Der Name kommt vom Unix-Befehl `tee`: ein Eingang, viele Ausgänge. Was ein Gerät in einen Raum schickt, kommt auf allen anderen an.

1. Auf der Startseite **„Raum erstellen“** klicken. Du bekommst einen 6-stelligen Code (ohne verwechselbare Zeichen und ohne Vokale, damit keine Wörter entstehen) und einen QR-Code.
2. Auf dem zweiten Gerät `https://<domain>/<CODE>` öffnen, den QR-Code scannen oder den Code auf der Startseite eingeben.
3. Text, Links und Dateien (Auswahl, Drag & Drop oder Einfügen aus der Zwischenablage) erscheinen sofort auf allen verbundenen Geräten.

Räume werden **24 h nach der letzten Aktivität** automatisch gelöscht, inklusive aller Dateien.

## Architektur

```
Browser ──HTTP──▶ Worker (src/worker.ts)
   ▲               ├─ /api/*  → src/server/api.ts ──RPC──▶ Durable Object "Room" (1 pro Raum, SQLite)
   │               │                    │                      ├─ items/meta in SQLite
   │               │                    └─ Upload/Download ──▶ R2 (rooms/<CODE>/<id>)
   │               └─ alles andere → Astro (SSR + statische Assets)
   └────WebSocket (Hibernation API) ◀──────────────────────────┘
```

- **Ein Worker** mit eigenem Entrypoint `src/worker.ts`. Er exportiert das Durable Object `Room` und reicht alle Nicht-API-Requests an Astro weiter (`@astrojs/cloudflare/handler`).
- **Durable Object pro Raum** (`src/server/room.ts`), SQLite-backed:
  - Tabellen `meta` (code, created_at, last_activity) und `items` (text/link/file, Datei-Metadaten, Status `pending` / `ready`).
  - WebSockets über die **Hibernation API** (`ctx.acceptWebSocket`). `ping`/`pong` läuft über `setWebSocketAutoResponse`, das DO muss dafür nicht aufwachen.
  - **Alarm**: Bei jeder Aktivität wird er auf jetzt + 24 h gesetzt. Wenn er auslöst, löscht er alle R2-Objekte unter `rooms/<CODE>/` und danach den gesamten DO-Storage.
- **Uploads** laufen als Stream durch den Worker nach R2: Erst reserviert das DO einen Eintrag (prüft dabei das 50er-Limit), dann wird über einen `FixedLengthStream` nach R2 geschrieben, dann bestätigt das DO den Eintrag und sendet ihn an alle Geräte.
- **Rate Limiting** über das Workers-Rate-Limiting-Binding, Schlüssel ist die IP (`cf-connecting-ip`).
- **Turnstile** schützt die Raumerstellung. Der Worker prüft das Token per `siteverify`. Ohne konfigurierte Keys ist Turnstile deaktiviert.
- **Sprachen: Deutsch und Englisch.** Die Middleware (`src/middleware.ts`) wählt die Sprache über das Cookie `lang`, sonst über `Accept-Language`, sonst Englisch. `?lang=de` bzw. `?lang=en` setzt das Cookie und leitet auf die URL ohne Parameter um. Raum-URLs bleiben sprachneutral (`/<CODE>`). Texte stehen in `src/i18n/index.ts`.

### Ende-zu-Ende-Verschlüsselung

Räume sind standardmäßig Ende-zu-Ende verschlüsselt (`src/scripts/crypto.ts`, Web Crypto, AES-256-GCM):

- Beim Erstellen erzeugt der Browser einen zufälligen 256-bit-Schlüssel und hängt ihn als Fragment an den Link: `/ABC234#k=…`. Browser schicken das Fragment nie an den Server, QR-Code und „Link kopieren“ enthalten es.
- **Texte/Links**: `{ k: 'text'|'link', c }` als JSON verschlüsselt, Base64url(IV | Chiffretext).
- **Dateien**: in 1-MiB-Blöcken. Kopf `TEE1 | Nonce-Präfix[8] | Blockgröße`, IV pro Block = Präfix | Blockindex, AAD markiert den letzten Block (erkennt Vertauschen und Abschneiden). Name, Typ und Originalgröße stehen verschlüsselt im `X-Filename`-Header (`X-Encrypted: 1`).
- Der Server speichert nur Chiffretext und sieht Anzahl, Größe und Zeitpunkt der Einträge sowie Text vs. Datei. Er erzwingt den Modus des Raums (`409 wrong_mode`).
- Wer den Code ohne Schlüssel öffnet, sieht eine Sperre und kann den Link einfügen.
- Wer beim Erstellen „Ende-zu-Ende verschlüsselt“ abwählt, bekommt einen Raum wie früher: Beitritt nur mit dem Code, Inhalte im Klartext.

> Web Crypto gibt es nur in sicheren Kontexten (HTTPS, `localhost`). Beim Testen über `http://<LAN-IP>` funktionieren verschlüsselte Räume deshalb nicht, unverschlüsselte schon.

### API

| Methode & Pfad | Zweck |
|---|---|
| `POST /api/rooms` | Body `{ turnstileToken, encrypted }` → `{ code }` (Turnstile + Rate-Limit `RL_CREATE`) |
| `GET /api/rooms/:code` | Existiert der Raum? 200 / 404 |
| `GET /api/rooms/:code/ws` | WebSocket für den Live-Sync |
| `POST /api/rooms/:code/text` | `{ text }` (Links werden erkannt) bzw. `{ ciphertext }` in verschlüsselten Räumen |
| `POST /api/rooms/:code/files` | Rohdaten als Body, Header `X-Filename` (URL-encoded) und `Content-Type` |
| `GET /api/rooms/:code/files/:id` | Download (`Content-Disposition: attachment`) |
| `DELETE /api/rooms/:code/items/:id` | Eintrag löschen |

WebSocket-Nachrichten (Server → Client): `init`, `item`, `delete`, `devices`. Siehe `src/shared/types.ts`.

### Grenzen (MVP)

| | |
|---|---|
| Max. Dateigröße | 100 MB (`src/shared/limits.ts`) |
| Max. Einträge pro Raum | 50 |
| Max. Textlänge | 100 KB |
| Raumerstellung | 10 / Minute / IP |
| Uploads, Text, Löschen | 30 / Minute / IP |
| Lebensdauer | 24 h nach letzter Aktivität |

> Das Rate-Limiting-Binding zählt pro Cloudflare-Standort und nicht exakt. Für Missbrauchsschutz im MVP reicht das.
> Cloudflare begrenzt die Request-Body-Größe je nach Plan (Free/Pro: 100 MB). Höhere Limits würden Multipart-Uploads erfordern.

## Projektstruktur

```
src/
├─ worker.ts              Worker-Entrypoint (API + Astro + export Room)
├─ server/
│  ├─ api.ts              API-Routen, Validierung, Rate Limiting, R2-Streaming
│  └─ room.ts             Durable Object (SQLite, WebSockets, Alarm)
├─ middleware.ts          Spracherkennung (Cookie / Accept-Language / ?lang=)
├─ i18n/index.ts          Texte DE/EN, Fehlercodes → Meldungen
├─ components/LangSwitch.astro
├─ shared/                Code von Client und Server gemeinsam
│  ├─ codes.ts            Code-Generator/-Validierung
│  ├─ limits.ts           Limits & TTL
│  ├─ types.ts            Item- und Message-Typen
│  └─ site.ts             Repo- und Support-Link
├─ pages/
│  ├─ index.astro         Landingpage (SSR wegen Sprache)
│  └─ [code].astro        Raum-Ansicht (SSR, 404 bei unbekanntem Code)
├─ scripts/
│  ├─ room-client.ts      WebSocket, Reconnect, Uploads mit Fortschritt, Drag & Drop
│  ├─ turnstile.ts        Turnstile-Widget (explizites Rendering)
│  └─ ui.ts               Toast, Clipboard
├─ layouts/Base.astro
└─ styles/global.css      Mobile-first, Dark Mode (folgt dem System, dunkel als Standard)
```

## Setup

Voraussetzungen: Node.js ≥ 22, ein Cloudflare-Account für das Deployment.

```sh
npm install
cp .dev.vars.example .dev.vars   # Turnstile-Test-Keys für lokal
```

## Entwicklung

```sh
npm run dev       # astro dev – läuft im workerd, inkl. Durable Objects, R2 & Rate Limits (lokal simuliert)
```

→ http://localhost:4321

Um den Produktions-Build lokal mit **wrangler dev** zu testen:

```sh
npm run preview   # astro build && wrangler dev
```

→ http://localhost:8787

Lokale Daten (DO-Storage, R2) liegen unter `.wrangler/state/` und können einfach gelöscht werden.
Zum Testen auf dem Handy im selben WLAN: `npm run dev -- --host` und dann `http://<LAN-IP>:4321` öffnen.

Weitere Skripte:

```sh
npm run check       # Typecheck (astro check)
npm run cf-typegen  # Env-Typen aus wrangler.jsonc neu erzeugen (worker-configuration.d.ts)
```

Vorschaubilder für geteilte Links (`public/og-de.png`, `public/og-en.png`) entstehen aus der Vorlage `og/og.html`:

```sh
npm run og   # rendert beide Sprachen per Headless-Chrome (macOS-Pfad, sonst CHROME=… setzen)
```

> **Tipp:** Um den Alarm lokal zu testen, `ROOM_TTL_MS` in `src/shared/limits.ts` kurz auf z. B. `5000` setzen.

## Deployment

1. Bei Cloudflare einloggen:
   ```sh
   npx wrangler login
   ```
2. R2-Buckets anlegen (einmalig):
   ```sh
   npx wrangler r2 bucket create tee-files --jurisdiction eu
   npx wrangler r2 bucket create tee-files-preview --jurisdiction eu   # für Previews
   ```
3. Bauen und deployen:
   ```sh
   npm run deploy    # astro build && wrangler deploy
   ```
   Beim ersten Deploy legt die Migration `v1` die SQLite-Klasse `Room` an.
4. **Eigene Domain**: Steht in `wrangler.jsonc` unter `routes` (aktuell `tee.chapter42.de`). Die Zone muss im selben Cloudflare-Account liegen, dann legt der Deploy den DNS-Record selbst an:
   ```jsonc
   "routes": [{ "pattern": "tee.chapter42.de", "custom_domain": true }]
   ```

### Turnstile einrichten

Für tee ist das schon erledigt: Das Widget „tee Raumerstellung“ existiert, der Site Key steht in `wrangler.jsonc`, und der Secret Key liegt als Secret für Produktion und die Preview `main`. Für ein neues Setup:

```sh
npx wrangler login   # braucht das Recht challenge-widgets.write
npx wrangler turnstile widget create "tee Raumerstellung" \
  --domain tee.chapter42.de --domain tee.<account>.workers.dev \
  --domain main-tee.<account>.workers.dev --mode managed
```

1. Den **Site Key** aus der Ausgabe in `wrangler.jsonc` unter `vars.TURNSTILE_SITE_KEY` und `previews.vars.TURNSTILE_SITE_KEY` eintragen.
2. Den **Secret Key** als Secret hinterlegen:
   ```sh
   npx wrangler secret put TURNSTILE_SECRET_KEY
   npx wrangler preview secret put TURNSTILE_SECRET_KEY --name main
   ```
3. `npm run deploy`

Bei einer eigenen Domain diese per `wrangler turnstile widget update <sitekey> --domain …` zum Widget hinzufügen.
Solange einer der beiden Keys fehlt, bleibt Turnstile aus. Das Rate Limiting greift trotzdem.

### Previews

Unter `previews` in `wrangler.jsonc` laufen Previews mit eigenem R2-Bucket (`tee-files-preview`) und eigenen Rate-Limit-Namespaces. Voraussetzung: Der Worker wurde mindestens einmal regulär deployt.

```sh
npm run deploy:preview -- --name mein-feature   # ohne --name: aktueller Git-Branch
```

URL: `https://<name>-tee.<account>.workers.dev`. Dazu kommt pro Deployment eine eindeutige URL.
Löschen mit `npx wrangler preview delete --name <name>`. `wrangler preview` ist derzeit Open Beta.

Logs live ansehen:

```sh
npx wrangler tail
```

### Konfiguration anpassen

- **Limits / TTL**: `src/shared/limits.ts`
- **Rate Limits**: `ratelimits` in `wrangler.jsonc` (`period` muss 10 oder 60 Sekunden sein)
- **Bucket-Name**: `r2_buckets` in `wrangler.jsonc`

Nach Änderungen an `wrangler.jsonc` die Typen mit `npm run cf-typegen` neu erzeugen. Die `dev`- und `build`-Skripte machen das automatisch.

## Bewusst nicht im MVP

Accounts, Ende-zu-Ende-Verschlüsselung, Persistenz über 24 h hinaus, Multipart-Uploads > 100 MB, Passwortschutz für Räume.
In unverschlüsselten Räumen hat Zugriff, wer den Code kennt. Bei 28⁶ ≈ 481 Mio. möglichen Codes und dem Rate Limit ist Raten unpraktikabel, es ist aber kein Geheimnisschutz. Verschlüsselte Räume schützt zusätzlich der 256-bit-Schlüssel im Link.
