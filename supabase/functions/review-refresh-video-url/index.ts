/**
 * POST /functions/v1/review-refresh-video-url
 * Body: { token, versionId }
 *
 * Пере видає короткоживучий signed URL до ПОТОЧНОЇ опублікованої версії,
 * коли старе спливає. Якщо версія вже змінилася — 409 (клієнт показує банер
 * «Доступна нова версія» замість тихого поновлення).
 */
import { bindCors, json, preflightResponse, resolveCors } from '../_shared/cors.ts';
import { serviceClient, type ReviewLinkJoined, type VersionRow } from '../_shared/db.ts';
import { clientKey, rateLimit } from '../_shared/rate_limit.ts';
import { hashToken, TOKEN_PATTERN } from '../_shared/tokens.ts';
import { z } from 'https://esm.sh/zod@3';

const SIGNED_URL_TTL = 7200;

const bodySchema = z.object({
  token: z.string().min(20).max(80),
  versionId: z.string().uuid(),
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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorRes(400, 'invalid_input', 'Некоректний JSON.');
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return errorRes(400, 'invalid_input', 'Некоректний формат запиту.');
  const { token, versionId } = parsed.data;
  if (!TOKEN_PATTERN.test(token)) return errorRes(401, 'invalid_or_revoked_link', 'Посилання некоректне.');

  const hash = await hashToken(token);
  const rl = rateLimit('review-refresh', clientKey(req, hash.slice(0, 16)), 60, 60_000);
  if (!rl.allowed) return errorRes(429, 'too_many_requests', 'Забагато запитів. Спробуйте пізніше.');

  const service = serviceClient();

  const { data: link } = await service
    .from('review_links')
    .select('id, project_id, is_active, revoked_at, projects!inner ( id, published_version_id )')
    .eq('token_hash', hash)
    .maybeSingle();
  const row = link as unknown as ReviewLinkJoined | null;
  if (!row || !row.is_active || row.revoked_at !== null || !row.projects) {
    return errorRes(403, 'invalid_or_revoked_link', 'Посилання більше не активне.');
  }
  if (!row.projects.published_version_id || row.projects.published_version_id !== versionId) {
    return errorRes(409, 'version_changed', 'Версія вже змінилася.');
  }

  const { data: version } = await service
    .from('video_versions')
    .select('id, storage_path, upload_status')
    .eq('id', versionId)
    .maybeSingle();
  const vrow = version as unknown as VersionRow | null;
  if (!vrow || vrow.upload_status !== 'ready') {
    return errorRes(404, 'no_published_version', 'Відео ще не опубліковано.');
  }

  const { data: signed, error: signedErr } = await service
    .storage
    .from('review-videos')
    .createSignedUrl(vrow.storage_path, SIGNED_URL_TTL);
  if (signedErr || !signed) {
    console.error('refresh signed url error', signedErr?.message);
    return errorRes(500, 'internal_error', 'Не вдалося підготувати відео.');
  }

  return json(200, {
    signedUrl: signed.signedUrl,
    expiresAt: new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString(),
  });
});
