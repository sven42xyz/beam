import type { MiddlewareHandler } from 'astro';
import { LANG_COOKIE, isLang, pickLang } from './i18n';

const ONE_YEAR = 60 * 60 * 24 * 365;

// Deliberately without `defineMiddleware` from 'astro:middleware': that import breaks the
// Vite dep optimizer in the workerd dev runner. The type alone is enough.
export const onRequest: MiddlewareHandler = async (ctx, next) => {
  // ?lang=de|en: remember the choice in a cookie and redirect to the clean URL
  const param = ctx.url.searchParams.get('lang');
  if (isLang(param)) {
    ctx.cookies.set(LANG_COOKIE, param, { path: '/', maxAge: ONE_YEAR, sameSite: 'lax' });
    const clean = new URL(ctx.url);
    clean.searchParams.delete('lang');
    return ctx.redirect(clean.pathname + clean.search + clean.hash, 302);
  }

  ctx.locals.lang = pickLang(ctx.cookies.get(LANG_COOKIE)?.value, ctx.request.headers.get('accept-language'));
  const response = await next();
  response.headers.append('Vary', 'Accept-Language, Cookie');
  return response;
};
