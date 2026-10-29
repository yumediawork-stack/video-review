/**
 * POST /functions/v1/agent-bootstrap   (--no-verify-jwt деплой!)
 * Body: { token }   // raw агент-токен
 *
 * Агент на ПК монтажера сам (без файлу конфігу) отримує свій набір налаштувань:
 * { projectId, apiUrl, publicKey }. Токен — єдиний secret; звідси він
 * хешується і шукається серед активних agent_links.
 *
 * ДЕПЛОЙ: supabase functions deploy agent-bootstrap --no-verify-jwt
 * (у запиті агента немає JWT; безпека — сам токен + rate limit).
 */
import { bindCors, json, preflightResponse, resolveCors } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/db.ts';
import { clientKey, rateLimit } from '../_shared/rate_limit.ts';
import { hashToken, TOKEN_PATTERN } from '../_shared/tokens.ts';
import { z } from 'https://esm.sh/zod@3';

const bodySchema = z.object({ token: z.string().min(20).max(80) });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    const cors = resolveCors(req);
    if (!cors.allowed) return new Response(null, { status: 403 });
    return preflightResponse(cors.headers);
  }
  if (req.method !== 'POST') return json(405, { error: { code: 'invalid_input', message: 'Метод не підтримується.' } });
  const cors = resolveCors(req);
  if (!cors.allowed) return json(403, { error: { code: 'cors_rejected', message: 'Origin не дозволено.' } });
  bindCors(cors);

  let raw: unknown;
  try { raw = await req.json(); } catch { return json(400, { error: { code: 'invalid_input', message: 'Некоректний JSON.' } }); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return json(400, { error: { code: 'invalid_input', message: 'Некоректний запит.' } });
  const token = parsed.data.token;
  if (!TOKEN_PATTERN.test(token)) return json(401, { error: { code: 'invalid_or_revoked_link', message: 'Агент-ключ некоректний.' } });

  const hash = await hashToken(token);
  const rl = rateLimit('agent-bootstrap', clientKey(req, hash.slice(0, 16)), 10, 60_000);
  if (!rl.allowed) return json(429, { error: { code: 'too_many_requests', message: 'Забагато запитів.' } });

  const service = serviceClient();
  const { data: link } = await service
    .from('agent_links')
    .select('id, project_id, is_active, revoked_at')
    .eq('token_hash', hash)
    .maybeSingle();
  const row = link as { id: string; project_id: string; is_active: boolean; revoked_at: string | null } | null;
  if (!row || !row.is_active || row.revoked_at !== null) {
    return json(403, { error: { code: 'invalid_or_revoked_link', message: 'Агент-ключ не активний. Активуйте новий у панелі «Трансляція з PC».' } });
  }

  const apiUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!apiUrl || !publicKey) {
    return json(500, { error: { code: 'internal_error', message: 'Конфігурація сервера неповна.' } });
  }

  return json(200, { projectId: row.project_id, apiUrl, publicKey });
});
