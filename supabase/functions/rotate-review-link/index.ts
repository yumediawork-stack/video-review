/**
 * POST /functions/v1/rotate-review-link  (адмінська дія, JWT admin)
 * Body: { projectId, action: 'create' | 'revoke', kind: 'review' | 'agent' = 'review' }
 *
 * kind='review' → гостьові review-посилання (review_links).
 * kind='agent'  → ключі локального агента-стрімера (agent_links):
 *   агент конфігурується raw-токеном один раз; announce через agent-announce.
 *
 * Зберігається ЛИШЕ hash; raw повертається РІВНО ОДИН РАЗ.
 */
import { bindCors, json, preflightResponse, resolveCors } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/db.ts';
import { generateToken, hashToken } from '../_shared/tokens.ts';
import { z } from 'https://esm.sh/zod@3';

const bodySchema = z.object({
  projectId: z.string().uuid(),
  action: z.union([z.literal('create'), z.literal('revoke')]),
  kind: z.union([z.literal('review'), z.literal('agent')]).default('review'),
});

function errorRes(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    const cors = resolveCors(req);
  bindCors(cors);
    if (!cors.allowed) return new Response(null, { status: 403 });
    return preflightResponse(cors.headers);
  }
  if (req.method !== 'POST') return errorRes(405, 'invalid_input', 'Метод не підтримується.');
  const cors = resolveCors(req);
  bindCors(cors);
  if (!cors.allowed) return errorRes(403, 'cors_rejected', 'Origin не дозволено.');

  const authHeader = req.headers.get('authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return errorRes(401, 'invalid_or_revoked_link', 'Потрібна авторизація адміна.');

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorRes(400, 'invalid_input', 'Некоректний JSON.');
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return errorRes(400, 'invalid_input', 'Некоректний формат запиту.');
  const { projectId, action, kind } = parsed.data;

  const service = serviceClient();

  // валідація JWT адміна (не покладаємось на приховані кнопки у frontend)
  const { data: userData, error: userErr } = await service.auth.getUser(jwt);
  const user = userData?.user;
  if (userErr || !user) return errorRes(401, 'invalid_or_revoked_link', 'Сесія недійсна.');

  const { data: adminRow } = await service.from('admin_users').select('id').eq('id', user.id).maybeSingle();
  if (!adminRow) return errorRes(403, 'invalid_or_revoked_link', 'Користувач не є адміном.');

  // власник проєкту
  const { data: project } = await service
    .from('projects')
    .select('id, owner_id')
    .eq('id', projectId)
    .maybeSingle();
  const proj = project as { id: string; owner_id: string } | null;
  if (!proj || proj.owner_id !== user.id) {
    return errorRes(404, 'not_found', 'Проєкт не знайдено.');
  }

  if (action === 'revoke') {
    if (kind === 'agent') {
      const { error } = await service
        .from('agent_links')
        .update({ is_active: false, revoked_at: new Date().toISOString() })
        .eq('project_id', projectId)
        .eq('is_active', true);
      if (error) {
        console.error('agent revoke error', error.message);
        return errorRes(500, 'internal_error', 'Не вдалося відкликати агент-ключ.');
      }
      return json(200, { ok: true });
    }
    // kind === 'review': відкликаємо всі досі активні посилання проєкту
    const { error: revokeErr } = await service
      .from('review_links')
      .update({ is_active: false, revoked_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('is_active', true);
    if (revokeErr) {
      console.error('revoke error', revokeErr.message);
      return errorRes(500, 'internal_error', 'Не вдалося відкликати посилання.');
    }
    return json(200, { ok: true });
  }

  // action === 'create' → ротація
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = new Date().toISOString();

  if (kind === 'agent') {
    const { error: rotErr } = await service
      .from('agent_links')
      .update({ is_active: false, revoked_at: now })
      .eq('project_id', projectId)
      .eq('is_active', true);
    if (rotErr) console.error('agent rotate deactivate error', rotErr.message);
    const { error: insertErr } = await service
      .from('agent_links')
      .insert({ project_id: projectId, token_hash: tokenHash, is_active: true });
    if (insertErr) {
      console.error('agent link insert error', insertErr.message);
      return errorRes(500, 'internal_error', 'Не вдалося створити агент-ключ.');
    }
    return json(200, { token, note: 'Агент-токен показується один раз. У БД збережено лише хеш.' });
  }

  const { error: rotErr } = await service
    .from('review_links')
    .update({ is_active: false, revoked_at: now })
    .eq('project_id', projectId)
    .eq('is_active', true);
  if (rotErr) console.error('rotate deactivate error', rotErr.message);

  const { error: insertErr } = await service
    .from('review_links')
    .insert({ project_id: projectId, token_hash: tokenHash, is_active: true });
  if (insertErr) {
    console.error('link insert error', insertErr.message);
    return errorRes(500, 'internal_error', 'Не вдалося створити посилання.');
  }

  return json(200, { token, note: 'Токен показується один раз. У БД збережено лише хеш.' });
});
