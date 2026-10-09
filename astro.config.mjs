// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  // Keine Sessions (würden sonst ein KV-Binding verlangen)
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
  devToolbar: { enabled: false },
  // qrcode ist CommonJS: fest vorab optimieren, sonst lädt der Dev-Server es teils erst verspätet
  vite: { optimizeDeps: { include: ['qrcode'] } },
});
