// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server',
  // Keine Sessions (würden sonst ein KV-Binding verlangen)
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
  devToolbar: { enabled: false },
});
