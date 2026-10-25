import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import * as comment from '@/functions/comment';
import * as like from '@/functions/like';
import type { Bindings } from '@/utils/config';
import { ApiError, response } from '@/utils/route';
import type { Handler } from '@/utils/route';

const app = new Hono<{ Bindings: Bindings }>();
const functions: Handler[] = Object.values({ ...like, ...comment });

app.use(
  '*',
  cors({
    origin: (_origin, c) =>
      c.env.CORS_ORIGIN || new URL(c.env.GHOST_URL || 'http://localhost:2368').origin,
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }),
);

app.use(
  '*',
  bodyLimit({
    maxSize: 64 * 1024,
    onError: () => response({ ok: false, reason: 'body-too-large' }, 413),
  }),
);

for (const fn of functions) {
  app[fn.method](fn.path, async c => {
    const request: Record<string, unknown> = {};
    for (const key of ['params', 'query', 'body'] as const) {
      const schema = fn.request?.[key];
      if (!schema) {
        continue;
      }

      const input =
        key === 'body'
          ? await c.req.json().catch(() => undefined)
          : key === 'params'
            ? c.req.param()
            : c.req.query();

      const parsed = await schema.safeParseAsync(input);
      if (!parsed.success) {
        return response({ ok: false, reason: `invalid-${key}`, issues: parsed.error.issues }, 422);
      }

      request[key] = parsed.data;
    }

    return fn.handle(c, request);
  });
}

app.get('/', () =>
  response({ ok: true, server: 'Kaede API Server', kaede: 'A neat Ghost theme' }, 418),
);

app.get('/health', () => response({ ok: true }));
app.notFound(() => response({ ok: false }, 404));
app.onError(error => {
  if (error instanceof ApiError) {
    return response({ ok: false, reason: error.message }, error.status);
  }
  console.error(error);
  return response({ ok: false, reason: 'internal-server' }, 500);
});

export default app;
export { AppStorage } from '@/utils/storage';
