// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  site: 'https://tee.chapter42.de',
  output: 'server',
  // No sessions (they would otherwise require a KV binding)
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
  devToolbar: { enabled: false },
  // qrcode is CommonJS: pre-bundle it explicitly, otherwise the dev server sometimes loads it too late
  vite: { optimizeDeps: { include: ['qrcode'] } },
});
