Ich will eine kleine Web-App namens "Beam" bauen: Text, Links und Dateien schnell zwischen Geräten austauschen (z. B. Handy → Laptop), ohne Login.

Kern-Flow:
- Startseite: "Raum erstellen" → es wird ein kurzer Code erzeugt (5–6 Zeichen, ohne verwechselbare Zeichen wie 0/O, 1/l), dazu ein QR-Code.
- Ein zweites Gerät öffnet beam.<domain>/<code> oder gibt den Code ein.
- Alles, was in den Raum geschickt wird (Text, Links, Dateien per Drag & Drop oder Datei-Auswahl), erscheint sofort live auf allen verbundenen Geräten.
- Text mit einem Klick kopieren, Dateien mit einem Klick herunterladen.
- Anzeige, wie viele Geräte gerade verbunden sind.

Tech-Stack (bitte so umsetzen):
- Frontend: Astro mit @astrojs/cloudflare, mobile-first, schlicht, Dark Mode.
- Backend: Cloudflare Workers, TypeScript.
- Ein Durable Object pro Raum (SQLite-backed), WebSockets über die Hibernation API für den Live-Sync.
- Dateien in R2. Upload über den Worker, Metadaten im DO.
- DO Alarm: Raum und alle R2-Objekte werden 24 h nach der letzten Aktivität automatisch gelöscht.
- Konfiguration über wrangler.jsonc, lokale Entwicklung mit wrangler dev.

Grenzen fürs MVP:
- Max. Dateigröße 100 MB, max. 50 Einträge pro Raum.
- Einfaches Rate Limiting pro IP (Raumerstellung und Uploads).
- Keine Accounts, keine Verschlüsselung, keine Persistenz über 24 h hinaus.

Bitte:
1. Mach zuerst einen kurzen Plan (Projektstruktur, Routen, DO-Schnittstelle, Datenmodell) und warte auf mein OK.
2. Danach umsetzen, inkl. README mit Setup-, Dev- und Deploy-Anleitung.
