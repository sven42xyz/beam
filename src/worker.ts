import { handle } from '@astrojs/cloudflare/handler';
import { handleApi } from './server/api';

export { Quota } from './server/quota';
export { Room } from './server/room';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) return handleApi(request, env);
    return handle(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
