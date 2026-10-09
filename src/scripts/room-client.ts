import QRCode from 'qrcode';
import type { Item, ServerMessage } from '../shared/types';
import { copyText, toast } from './ui';

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

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && name.length - dot <= 5 ? name.slice(dot + 1) : 'file';
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string };
    return data.message ?? `Fehler ${res.status}`;
  } catch {
    return `Fehler ${res.status}`;
  }
}

export function initRoom(root: HTMLElement) {
  const code = root.dataset.code!;
  const maxFile = Number(root.dataset.maxFile);
  const maxItems = Number(root.dataset.maxItems);
  const roomUrl = `${location.origin}/${code}`;
  const api = `/api/rooms/${code}`;

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

  const items = new Map<string, Item>();

  // ---------- Teilen ----------

  $('room-url').textContent = roomUrl;
  $('copy-link').addEventListener('click', async () => {
    if (await copyText(roomUrl)) toast('Link kopiert');
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

  function renderItem(item: Item): HTMLLIElement {
    const li = h('li', { className: 'item' });
    li.dataset.id = item.id;
    const foot = h('div', { className: 'item-foot' });
    const meta = h('span', { className: 'meta' }, formatTime(item.createdAt));

    if (item.kind === 'file') {
      const body = h(
        'div',
        { className: 'item-body item-file' },
        h('span', { className: 'file-icon' }, extOf(item.name!)),
        h('div', {}, h('div', { className: 'file-name' }, item.name!), h('div', { className: 'muted small' }, formatBytes(item.size!))),
      );
      const dl = h('a', { className: 'btn btn-small btn-primary', href: `${api}/files/${item.id}`, textContent: 'Herunterladen' });
      dl.setAttribute('download', item.name!);
      add(li, body);
      add(foot, meta, dl);
    } else {
      const content = item.content!;
      const body =
        item.kind === 'link'
          ? h('a', { className: 'item-body item-link', href: content, target: '_blank', rel: 'noopener noreferrer' }, content)
          : h('pre', { className: 'item-body item-text' }, content);
      const copy = h('button', { className: 'btn btn-small btn-primary', textContent: 'Kopieren' });
      copy.addEventListener('click', async () => {
        if (await copyText(content)) toast('Kopiert');
      });
      add(li, body);
      add(foot, meta, copy);
    }

    const del = h('button', { className: 'btn btn-small btn-ghost btn-delete', textContent: '✕', title: 'Löschen' });
    del.setAttribute('aria-label', 'Eintrag löschen');
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
    expiryEl.textContent = `Raum wird gelöscht am ${new Date(expiresAt).toLocaleString(undefined, {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })} (24 h nach letzter Aktivität).`;
  }

  function addItem(item: Item, prepend = true) {
    if (items.has(item.id)) return;
    items.set(item.id, item);
    const li = renderItem(item);
    itemsEl.insertBefore(li, prepend ? itemsEl.firstChild : null);
    updateMeta();
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
    setStatus('connecting', 'Verbinde…');
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}${api}/ws`);

    ws.addEventListener('open', () => {
      retry = 0;
      clearInterval(pingTimer);
      pingTimer = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('ping'), PING_INTERVAL_MS);
    });

    ws.addEventListener('message', (e) => {
      if (e.data === 'pong') return;
      const msg = JSON.parse(e.data) as ServerMessage;
      switch (msg.type) {
        case 'init':
          items.clear();
          itemsEl.replaceChildren();
          msg.items.forEach((item) => addItem(item, false));
          updateMeta();
          setExpiry(msg.expiresAt);
          setDevices(msg.devices);
          break;
        case 'item':
          addItem(msg.item);
          setExpiry(msg.expiresAt);
          break;
        case 'delete':
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
        setStatus('offline', 'Raum abgelaufen');
        location.reload();
        return;
      }
      setStatus('offline', 'Offline – verbinde neu…');
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
    setStatus('online', n === 1 ? '1 Gerät' : `${n} Geräte`);
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
    sendBtn.disabled = true;
    try {
      const res = await fetch(`${api}/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      addItem(await res.json());
      textEl.value = '';
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Senden fehlgeschlagen');
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

  function uploadFile(file: File) {
    if (file.size > maxFile) {
      toast(`„${file.name}“ ist zu groß (max. ${formatBytes(maxFile)})`);
      return;
    }
    const progress = h('progress', { max: 1, value: 0 });
    const label = h('div', {}, `${file.name} · ${formatBytes(file.size)}`);
    const row = h('li', { className: 'upload' }, label, progress);
    uploadsEl.appendChild(row);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${api}/files`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) progress.value = e.loaded / e.total;
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        addItem(JSON.parse(xhr.responseText));
        row.remove();
      } else {
        let message = `Fehler ${xhr.status}`;
        try {
          message = JSON.parse(xhr.responseText).message ?? message;
        } catch {}
        fail(message);
      }
    });
    xhr.addEventListener('error', () => fail('Netzwerkfehler'));

    function fail(message: string) {
      row.classList.add('failed');
      label.textContent = `${file.name}: ${message}`;
      progress.remove();
      setTimeout(() => row.remove(), 6000);
    }

    xhr.send(file);
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
