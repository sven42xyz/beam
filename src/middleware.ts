import type { MiddlewareHandler } from 'astro';
import { LANG_COOKIE, isLang, pickLang } from './i18n';

const ONE_YEAR = 60 * 60 * 24 * 365;

// Hinweis: bewusst ohne `defineMiddleware` aus 'astro:middleware' – der Import bricht den
// Vite-Dep-Optimizer im workerd-Dev-Runner. Der Typ allein reicht.
export const onRequest: MiddlewareHandler = async (ctx, next) => {
  // ?lang=de|en: Wahl im Cookie merken und auf die saubere URL umleiten
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
