# Beam

Text, Links und Dateien schnell zwischen Geräten austauschen (z. B. Handy → Laptop), ohne Login.

1. Auf der Startseite **„Raum erstellen“** klicken. Du bekommst einen 6-stelligen Code (ohne 0/O/1/I/L) und einen QR-Code.
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

### API

| Methode & Pfad | Zweck |
|---|---|
| `POST /api/rooms` | Raum erstellen → `{ code }` (Rate-Limit `RL_CREATE`) |
| `GET /api/rooms/:code` | Existiert der Raum? 200 / 404 |
| `GET /api/rooms/:code/ws` | WebSocket für den Live-Sync |
| `POST /api/rooms/:code/text` | `{ text }` → Eintrag (Links werden automatisch erkannt) |
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
├─ shared/                Code von Client und Server gemeinsam
│  ├─ codes.ts            Code-Generator/-Validierung
│  ├─ limits.ts           Limits & TTL
│  └─ types.ts            Item- und Message-Typen
├─ pages/
│  ├─ index.astro         Startseite (prerendered)
│  └─ [code].astro        Raum-Ansicht (SSR, 404 bei unbekanntem Code)
├─ scripts/
│  ├─ room-client.ts      WebSocket, Reconnect, Uploads mit Fortschritt, Drag & Drop
│  └─ ui.ts               Toast, Clipboard
├─ layouts/Base.astro
└─ styles/global.css      Mobile-first, Dark Mode (folgt dem System, dunkel als Standard)
```

## Setup

Voraussetzungen: Node.js ≥ 22, ein Cloudflare-Account für das Deployment.

```sh
npm install
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

> **Tipp:** Um den Alarm lokal zu testen, `ROOM_TTL_MS` in `src/shared/limits.ts` kurz auf z. B. `5000` setzen.

## Deployment

1. Bei Cloudflare einloggen:
   ```sh
   npx wrangler login
   ```
2. R2-Buckets anlegen (einmalig):
   ```sh
   npx wrangler r2 bucket create beam-files
   npx wrangler r2 bucket create beam-files-preview   # für Previews
   ```
3. Bauen und deployen:
   ```sh
   npm run deploy    # astro build && wrangler deploy
   ```
   Beim ersten Deploy legt die Migration `v1` die SQLite-Klasse `Room` an.
4. **Eigene Domain** (z. B. `beam.example.com`): Im Cloudflare-Dashboard unter *Workers & Pages → beam → Settings → Domains & Routes → Add → Custom Domain* eintragen. Alternativ in `wrangler.jsonc`:
   ```jsonc
   "routes": [{ "pattern": "beam.example.com", "custom_domain": true }]
   ```

### Previews

Unter `previews` in `wrangler.jsonc` laufen Previews mit eigenem R2-Bucket (`beam-files-preview`) und eigenen Rate-Limit-Namespaces. Voraussetzung: Der Worker wurde mindestens einmal regulär deployt.

```sh
npm run deploy:preview -- --name mein-feature   # ohne --name: aktueller Git-Branch
```

URL: `https://<name>-beam.<account>.workers.dev`. Dazu kommt pro Deployment eine eindeutige URL.
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
Wer den Code kennt, hat Zugriff auf den Raum. Bei 31⁶ ≈ 887 Mio. möglichen Codes und dem Rate Limit ist Raten unpraktikabel, es ist aber kein Geheimnisschutz.
