// Minimaler Wrapper um Cloudflare Turnstile (explizites Rendering).
// Docs: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  reset(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_TIMEOUT_MS = 30_000;

let widgetId: string | undefined;
let token: string | null = null;
let waiters: ((token: string) => void)[] = [];
let failed: ((err: Error) => void)[] = [];
let broken = false;

function failAll() {
  failed.forEach((f) => f(new Error('turnstile')));
  waiters = [];
  failed = [];
}

// Prüft auf die echte API: ein Element mit id="turnstile" würde sonst als window.turnstile durchgehen
function api(): TurnstileApi | undefined {
  return typeof window.turnstile?.render === 'function' ? window.turnstile : undefined;
}

function loadScript(): Promise<TurnstileApi> {
  const existing = api();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      const loaded = api();
      if (loaded) resolve(loaded);
      else reject(new Error('turnstile'));
    };
    script.onerror = () => reject(new Error('turnstile'));
    document.head.appendChild(script);
  });
}

export async function initTurnstile(container: HTMLElement, siteKey: string, language: string) {
  let turnstile: TurnstileApi;
  try {
    turnstile = await loadScript();
  } catch {
    // z. B. von einem Adblocker blockiert
    broken = true;
    failAll();
    return;
  }
  widgetId = turnstile.render(container, {
    sitekey: siteKey,
    language,
    action: 'create_room',
    // Nur sichtbar, wenn wirklich eine Interaktion nötig ist
    appearance: 'interaction-only',
    callback: (t: string) => {
      token = t;
      waiters.forEach((w) => w(t));
      waiters = [];
      failed = [];
    },
    'expired-callback': () => {
      token = null;
    },
    'error-callback': failAll,
  });
}

/** Wartet auf ein gültiges Token. Tokens sind einmalig, danach resetTurnstile() aufrufen. */
export function getTurnstileToken(): Promise<string> {
  if (broken) return Promise.reject(new Error('turnstile'));
  if (token) {
    const t = token;
    token = null;
    return Promise.resolve(t);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('turnstile')), TOKEN_TIMEOUT_MS);
    waiters.push((t) => {
      clearTimeout(timer);
      token = null;
      resolve(t);
    });
    failed.push((err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function resetTurnstile() {
  token = null;
  api()?.reset(widgetId);
}
