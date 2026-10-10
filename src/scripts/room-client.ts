import QRCode from 'qrcode';
import { apiErrorMessage, isLang, useTranslations, type Lang } from '../i18n';
import { MAX_TEXT_BYTES } from '../shared/limits';
import type { Item, ItemKind, ServerMessage } from '../shared/types';
import { decryptJson, decryptStream, encryptedSize, encryptFile, encryptJson, importKey, keyFromHash } from './crypto';
import { copyText, toast } from './ui';

/** Ein Eintrag, wie das Gerät ihn anzeigt: in verschlüsselten Räumen bereits entschlüsselt. */
interface View {
  id: string;
  kind: ItemKind;
  createdAt: number;
  enc: boolean;
  /** Konnte nicht entschlüsselt werden (falscher Schlüssel o. Ä.) */
  failed?: boolean;
  content?: string;
  name?: string;
  size?: number;
  mime?: string;
}

/** Verschlüsselter Text: Art und Inhalt */
interface TextPayload {
  k: 'text' | 'link';
  c: string;
}
/** Verschlüsselte Datei-Metadaten: Name, Typ, Originalgröße */
interface FileMeta {
  n: string;
  m: string;
  s: number;
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

const PING_INTERVAL_MS = 25_000;

function $(id: string) {
  return document.getElementById(id)!;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = Object.assign(document.createElement(tag), props);
  add(el, ...children);
  return el;
}

// Node.appendChild statt Element.append: die Workers-Typen (HTMLRewriter) überlagern Element.append/prepend
function add(parent: Node, ...children: (Node | string)[]) {
  for (const c of children) parent.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function formatTime(ts: number, lang: Lang): string {
  return new Date(ts).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && name.length - dot <= 5 ? name.slice(dot + 1) : 'file';
}

async function readErrorCode(res: Response): Promise<string | undefined> {
  try {
    return ((await res.json()) as { error?: string }).error;
  } catch {
    return undefined;
  }
}

export async function initRoom(root: HTMLElement) {
  const code = root.dataset.code!;
  const encrypted = root.dataset.encrypted === '1';
  const lang: Lang = isLang(root.dataset.lang) ? root.dataset.lang : 'en';
  const t = useTranslations(lang);
  const errorMessage = async (res: Response) => apiErrorMessage(t, await readErrorCode(res), res.status);
  const maxFile = Number(root.dataset.maxFile);
  const maxItems = Number(root.dataset.maxItems);
  const api = `/api/rooms/${code}`;

  // ---------- Schlüssel (nur in verschlüsselten Räumen) ----------

  const keyText = encrypted ? keyFromHash(location.hash) : null;
  let key: CryptoKey | null = null;
  if (keyText) {
    try {
      key = await importKey(keyText);
    } catch {
      key = null;
    }
  }
  if (encrypted && !key) {
    showLocked();
    return;
  }

  // Der Link enthält in verschlüsselten Räumen den Schlüssel
  const roomUrl = `${location.origin}/${code}${keyText ? `#k=${keyText}` : ''}`;
  const shownUrl = keyText ? `${location.host}/${code}#k=${keyText.slice(0, 6)}…` : roomUrl;

  function showLocked() {
    $('locked').hidden = false;
    $('room-content').hidden = true;
    $('status').hidden = true;
    // Ein QR-Code ohne Schlüssel würde nur wieder zu dieser Sperre führen
    $('toggle-qr').hidden = true;
    const form = $('unlock') as HTMLFormElement;
    const input = $('unlock-link') as HTMLInputElement;
    const err = $('unlock-error');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      try {
        const url = new URL(input.value.trim());
        if (url.pathname.replace(/^\//, '').toUpperCase() === code && keyFromHash(url.hash)) {
          location.hash = url.hash;
          location.reload();
          return;
        }
      } catch {
        // kein gültiger Link
      }
      err.hidden = false;
    });
  }

  async function toView(item: Item): Promise<View> {
    const base = { id: item.id, createdAt: item.createdAt, enc: !!item.enc };
    if (!item.enc) return { ...base, kind: item.kind, content: item.content, name: item.name, size: item.size, mime: item.mime };
    try {
      if (item.kind === 'file') {
        const meta = await decryptJson<FileMeta>(key!, item.name!);
        return { ...base, kind: 'file', name: meta.n, mime: meta.m, size: meta.s };
      }
      const payload = await decryptJson<TextPayload>(key!, item.content!);
      return { ...base, kind: payload.k === 'link' ? 'link' : 'text', content: payload.c };
    } catch {
      return { ...base, kind: item.kind, failed: true };
    }
  }

  const itemsEl = $('items') as HTMLUListElement;
  const uploadsEl = $('uploads') as HTMLUListElement;
  const emptyEl = $('empty');
  const countEl = $('count');
  const expiryEl = $('expiry');
  const statusEl = $('status');
  const statusText = $('status-text');
  const textEl = $('text') as HTMLTextAreaElement;
  const sendBtn = $('send') as HTMLButtonElement;
  const fileInput = $('file') as HTMLInputElement;
  const dropzone = $('dropzone');

  const items = new Map<string, View>();

  // ---------- Teilen ----------

  $('room-url').textContent = shownUrl;
  $('copy-link').addEventListener('click', async () => {
    if (await copyText(roomUrl)) toast(t.room.linkCopied);
  });

  const qrPanel = $('qr-panel');
  const qrToggle = $('toggle-qr');
  let qrDrawn = false;
  qrToggle.addEventListener('click', async () => {
    qrPanel.hidden = !qrPanel.hidden;
    qrToggle.setAttribute('aria-expanded', String(!qrPanel.hidden));
    if (!qrDrawn) {
      qrDrawn = true;
      await QRCode.toCanvas($('qr') as HTMLCanvasElement, roomUrl, { width: 220, margin: 2 });
    }
  });
  // Auf großen Bildschirmen (Laptop) den QR-Code direkt zeigen – dort scannt man ihn mit dem Handy
  if (matchMedia('(min-width: 720px)').matches) qrToggle.click();

  // ---------- Rendering ----------

  function renderItem(item: View): HTMLLIElement {
    const li = h('li', { className: 'item' });
    li.dataset.id = item.id;
    // Buttons beziehen sich per aria-describedby auf den Inhalt („Kopieren: Hallo Welt“)
    const bodyId = `item-${item.id}`;
    const foot = h('div', { className: 'item-foot' });
    const meta = h('span', { className: 'meta' }, formatTime(item.createdAt, lang));

    if (item.failed) {
      add(li, h('p', { className: 'item-body muted', id: bodyId }, `🔒 ${t.room.decryptFailed}`));
      add(foot, meta);
    } else if (item.kind === 'file') {
      const body = h(
        'div',
        { className: 'item-body item-file' },
        h('span', { className: 'file-icon' }, extOf(item.name!)),
        h('div', {}, h('div', { className: 'file-name', id: bodyId }, item.name!), h('div', { className: 'muted small' }, formatBytes(item.size!))),
      );
      body.querySelector('.file-icon')?.setAttribute('aria-hidden', 'true');
      let dl: HTMLElement;
      if (item.enc) {
        // Verschlüsselt: herunterladen, im Browser entschlüsseln, dann speichern
        const btn = h('button', { className: 'btn btn-small btn-primary', textContent: t.room.download });
        btn.addEventListener('click', () => downloadEncrypted(item, btn));
        dl = btn;
      } else {
        dl = h('a', { className: 'btn btn-small btn-primary', href: `${api}/files/${item.id}`, textContent: t.room.download });
        dl.setAttribute('download', item.name!);
      }
      dl.setAttribute('aria-describedby', bodyId);
      add(li, body);
      add(foot, meta, dl);
    } else {
      const content = item.content!;
      const body =
        item.kind === 'link'
          ? h('a', { className: 'item-body item-link', href: content, target: '_blank', rel: 'noopener noreferrer', id: bodyId }, content)
          : h('pre', { className: 'item-body item-text', id: bodyId }, content);
      const copy = h('button', { className: 'btn btn-small btn-primary', textContent: t.room.copy });
      copy.setAttribute('aria-describedby', bodyId);
      copy.addEventListener('click', async () => {
        if (await copyText(content)) toast(t.room.copied);
      });
      add(li, body);
      add(foot, meta, copy);
    }

    const del = h('button', { className: 'btn btn-small btn-ghost btn-delete', textContent: '✕', title: t.room.delete });
    del.setAttribute('aria-label', t.room.deleteItem);
    del.setAttribute('aria-describedby', bodyId);
    del.addEventListener('click', async () => {
      del.disabled = true;
      const res = await fetch(`${api}/items/${item.id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) {
        toast(await errorMessage(res));
        del.disabled = false;
      }
    });
    add(foot, del);
    add(li, foot);
    return li;
  }

  function updateMeta() {
    emptyEl.hidden = items.size > 0;
    countEl.textContent = `${items.size} / ${maxItems}`;
  }

  function setExpiry(expiresAt: number) {
    const date = new Date(expiresAt).toLocaleString(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    expiryEl.textContent = t.room.expiresAt(date);
  }

  async function downloadEncrypted(item: View, btn: HTMLButtonElement) {
    btn.disabled = true;
    try {
      const res = await fetch(`${api}/files/${item.id}`);
      if (!res.ok || !res.body) throw new Error(await errorMessage(res));
      const total = Number(res.headers.get('Content-Length')) || 0;
      const blob = await decryptStream(key!, res.body, item.mime || 'application/octet-stream', (done) => {
        btn.textContent = total ? `${t.room.decrypting} ${Math.round((done / total) * 100)} %` : t.room.decrypting;
      });
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: item.name! });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : t.room.decryptFailed);
    } finally {
      btn.textContent = t.room.download;
      btn.disabled = false;
    }
  }

  function addItem(item: View, prepend = true): boolean {
    if (items.has(item.id)) return false;
    items.set(item.id, item);
    const li = renderItem(item);
    itemsEl.insertBefore(li, prepend ? itemsEl.firstChild : null);
    updateMeta();
    return true;
  }

  // Screenreader-Ansagen für Änderungen, die von anderen Geräten kommen
  const announcer = $('announcer');
  function announce(text: string) {
    announcer.textContent = '';
    setTimeout(() => (announcer.textContent = text), 50);
  }
  function describe(item: View): string {
    if (item.failed) return t.room.decryptFailed;
    if (item.kind === 'file') return item.name!;
    const kind = item.kind === 'link' ? t.room.kindLink : t.room.kindText;
    return `${kind}, ${item.content!.slice(0, 80)}`;
  }

  function removeItem(id: string) {
    items.delete(id);
    itemsEl.querySelector(`[data-id="${CSS.escape(id)}"]`)?.remove();
    updateMeta();
  }

  function setStatus(state: 'connecting' | 'online' | 'offline', text: string) {
    statusEl.dataset.state = state;
    statusText.textContent = text;
  }

  // ---------- WebSocket mit Reconnect ----------

  let ws: WebSocket | null = null;
  let retry = 0;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let gone = false;

  function connect() {
    if (gone) return;
    setStatus('connecting', t.room.connecting);
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}${api}/ws`);

    ws.addEventListener('open', () => {
      retry = 0;
      clearInterval(pingTimer);
      pingTimer = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), PING_INTERVAL_MS);
    });

    ws.addEventListener('message', async (e) => {
      if (e.data === 'pong') return;
      const msg = JSON.parse(e.data) as ServerMessage;
      switch (msg.type) {
        case 'init': {
          const views = await Promise.all(msg.items.map(toView));
          items.clear();
          itemsEl.replaceChildren();
          views.forEach((view) => addItem(view, false));
          updateMeta();
          setExpiry(msg.expiresAt);
          setDevices(msg.devices);
          break;
        }
        case 'item': {
          setExpiry(msg.expiresAt);
          if (items.has(msg.item.id)) break;
          const view = await toView(msg.item);
          if (addItem(view)) announce(t.room.announceItem(describe(view)));
          break;
        }
        case 'delete':
          if (items.has(msg.id)) announce(t.room.announceDeleted);
          removeItem(msg.id);
          setExpiry(msg.expiresAt);
          break;
        case 'devices':
          setDevices(msg.count);
          break;
      }
    });

    ws.addEventListener('close', async (e) => {
      clearInterval(pingTimer);
      if (e.code === 4404 || !(await roomExists())) {
        gone = true;
        setStatus('offline', t.room.expired);
        location.reload();
        return;
      }
      setStatus('offline', t.room.reconnecting);
      const delay = Math.min(1000 * 2 ** retry++, 15_000);
      setTimeout(connect, delay);
    });
  }

  async function roomExists(): Promise<boolean> {
    try {
      const res = await fetch(api, { cache: 'no-store' });
      return res.status !== 404;
    } catch {
      return true; // Netzwerkfehler ≠ Raum weg
    }
  }

  function setDevices(n: number) {
    setStatus('online', t.room.devices(n));
  }

  // Nach Standby / Tab-Wechsel schnell wieder verbinden
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ws && ws.readyState === WebSocket.CLOSED) {
      retry = 0;
      connect();
    }
  });

  connect();

  // ---------- Text senden ----------

  async function sendText() {
    const text = textEl.value.trim();
    if (!text) return;
    if (new TextEncoder().encode(text).length > MAX_TEXT_BYTES) {
      toast(t.errors.too_large);
      return;
    }
    sendBtn.disabled = true;
    try {
      const body = key
        ? { ciphertext: await encryptJson(key, { k: isLink(text) ? 'link' : 'text', c: text } satisfies TextPayload) }
        : { text };
      const res = await fetch(`${api}/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      addItem(await toView(await res.json()));
      textEl.value = '';
    } catch (e) {
      toast(e instanceof Error ? e.message : t.errors.sendFailed);
    } finally {
      sendBtn.disabled = false;
    }
  }

  sendBtn.addEventListener('click', sendText);
  textEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      sendText();
    }
  });

  // ---------- Dateien hochladen ----------

  async function uploadFile(file: File) {
    // Verschlüsselt wird die Datei etwas größer (Kopf + 16 Byte pro MiB)
    if ((key ? encryptedSize(file.size) : file.size) > maxFile) {
      toast(t.room.fileTooLarge(file.name, formatBytes(maxFile)));
      return;
    }
    const progress = h('progress', { max: 1, value: 0 });
    progress.setAttribute('aria-label', file.name);
    const caption = `${file.name} · ${formatBytes(file.size)}`;
    const label = h('div', {}, key ? `${caption} · ${t.room.encrypting}` : caption);
    const row = h('li', { className: 'upload' }, label, progress);
    uploadsEl.appendChild(row);

    let body: Blob = file;
    let name = encodeURIComponent(file.name);
    if (key) {
      try {
        name = await encryptJson(key, { n: file.name, m: file.type || 'application/octet-stream', s: file.size } satisfies FileMeta);
        body = await encryptFile(key, file, (done) => (progress.value = file.size ? done / file.size : 1));
      } catch {
        fail(t.errors.upload_failed);
        return;
      }
      label.textContent = caption;
      progress.value = 0;
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${api}/files`);
    xhr.setRequestHeader('Content-Type', key ? 'application/octet-stream' : file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', name);
    if (key) xhr.setRequestHeader('X-Encrypted', '1');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) progress.value = e.loaded / e.total;
    });
    xhr.addEventListener('load', async () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        addItem(await toView(JSON.parse(xhr.responseText)));
        row.remove();
      } else {
        let errorCode: string | undefined;
        try {
          errorCode = JSON.parse(xhr.responseText).error;
        } catch {}
        fail(apiErrorMessage(t, errorCode, xhr.status));
      }
    });
    xhr.addEventListener('error', () => fail(t.errors.network));

    function fail(message: string) {
      row.classList.add('failed');
      label.textContent = `${file.name}: ${message}`;
      progress.remove();
      setTimeout(() => row.remove(), 6000);
    }

    xhr.send(body);
  }

  function uploadFiles(files: Iterable<File>) {
    for (const file of files) uploadFile(file);
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files) uploadFiles(fileInput.files);
    fileInput.value = '';
  });

  // Drag & Drop auf der ganzen Seite
  let dragDepth = 0;
  const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dropzone.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--dragDepth <= 0) {
      dragDepth = 0;
      dropzone.hidden = true;
    }
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropzone.hidden = true;
    if (e.dataTransfer?.files.length) uploadFiles(e.dataTransfer.files);
  });

  // Dateien (z. B. Screenshots) aus der Zwischenablage einfügen
  window.addEventListener('paste', (e) => {
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      uploadFiles(files);
    }
  });
}
