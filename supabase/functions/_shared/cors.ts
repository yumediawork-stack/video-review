/**
 * CORS: дозволені тільки origin зі списку ALLOWED_ORIGINS (comma-separated).
 * Dev-дефолт: localhost порти Vite. Виробництво — обов'язково задати секрет:
 *   supabase secrets set ALLOWED_ORIGINS=http://localhost:5173,https://username.gitlab.io
 * Без «*» для приватної API.
 */
export type Cors = { headers: Record<string, string>; allowed: boolean };

function allowedOrigins(): string[] {
  const raw = Deno.env.get('ALLOWED_ORIGINS') ?? '';
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length > 0) return list;
  return [
    'http://localhost:5173',
    'http://localhost:4173',
    'http://localhost:3000',
    'http://127.0.0.1:5173',
    'http://127.0.0.1:4173',
    'http://127.0.0.1:3000',
  ];
}

export function resolveCors(req: Request): Cors {
  const origin = req.headers.get('origin');
  if (!origin) {
    // не браузерний запит (curl/CI) — CORS-заголовки не потрібні
    return { headers: {}, allowed: true };
  }
  const allowed = allowedOrigins();
  if (allowed.includes(origin)) {
    return {
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
      allowed: true,
    };
  }
  return { headers: {}, allowed: false };
}

export function preflightResponse(): Response {
  return new Response(null, { status: 204 });
}

export function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}
