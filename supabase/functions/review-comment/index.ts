/**
 * POST /functions/v1/review-comment
 * Body: { token, versionId, parentId?, authorName, text, timestampSeconds }
 *
 * Нічого не довіряємо без перевірки:
 *  - токен хешується і шукається серед активних посилань;
 *  - versionId МАЄ дорівнювати поточній опублікованій версії проєкту посилання,
 *    інакше 409 version_changed;
 *  - parentId мусить бути непублікований корінь ТІЄЇ Ж версії (1 рівень;
 *    це фінально перевіряється також схемою БД);
 *  - валідація тексту/імен/таймкоду дублюється тут (не тільки в браузері).
 */
import { json, preflightResponse, resolveCors } from '../_shared/cors.ts';
import { serviceClient, type CommentRow, type ReviewLinkJoined, type VersionRow } from '../_shared/db.ts';
import { clientKey, rateLimit } from '../_shared/rate_limit.ts';
import { hashToken, TOKEN_PATTERN } from '../_shared/tokens.ts';
import { z } from 'https://esm.sh/zod@3';

const DURATION_TOLERANCE = 1.5;

const bodySchema = z.object({
  token: z.string().min(20).max(80),
  versionId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  authorName: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(60)),
  text: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(2000)),
  timestampSeconds: z.number().finite().min(0).max(86400 * 4),
});

function errorRes(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    const cors = resolveCors(req);
    if (!cors.allowed) return new Response(null, { status: 403 });
    return preflightResponse();
  }
  if (req.method !== 'POST') return errorRes(405, 'invalid_input', 'Метод не підтримується.');
  const cors = resolveCors(req);
  if (!cors.allowed) return errorRes(403, 'cors_rejected', 'Origin не дозволено.');

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return errorRes(400, 'invalid_input', 'Некоректний JSON.');
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return errorRes(400, 'invalid_input', 'Некоректні дані форми.');
  const { token, versionId, parentId, authorName, text, timestampSeconds } = parsed.data;
  if (!TOKEN_PATTERN.test(token)) return errorRes(401, 'invalid_or_revoked_link', 'Посилання некоректне.');

  const hash = await hashToken(token);
  const rl = rateLimit('review-comment', clientKey(req, hash.slice(0, 16)), 10, 60_000);
  if (!rl.allowed) return errorRes(429, 'too_many_requests', 'Забагато запитів. Спробуйте за хвилину.');

  const service = serviceClient();

  const { data: link } = await service
    .from('review_links')
    .select('id, project_id, is_active, revoked_at, projects!inner ( id, title, published_version_id )')
    .eq('token_hash', hash)
    .maybeSingle();
  const row = link as unknown as ReviewLinkJoined | null;
  if (!row || !row.is_active || row.revoked_at !== null || !row.projects) {
    return errorRes(403, 'invalid_or_revoked_link', 'Посилання більше не активне.');
  }
  const project = row.projects;

  // критично: коментарі — тільки до ПОТОЧНОЇ опублікованої версії
  if (!project.published_version_id || project.published_version_id !== versionId) {
    return errorRes(409, 'version_changed', 'Доступна нова версія. Оновіть відео, щоб коментувати актуальну.');
  }

  const { data: version } = await service
    .from('video_versions')
    .select('id, upload_status, duration_seconds')
    .eq('id', versionId)
    .maybeSingle();
  const vrow = version as unknown as VersionRow | null;
  if (!vrow || vrow.upload_status !== 'ready') {
    return errorRes(404, 'no_published_version', 'Відео ще не опубліковано.');
  }
  if (vrow.duration_seconds != null && Number(vrow.duration_seconds) > 0) {
    if (timestampSeconds > Number(vrow.duration_seconds) + DURATION_TOLERANCE) {
      return errorRes(400, 'invalid_input', 'Таймкод виходить за тривалість відео.');
    }
  }

  if (parentId) {
    const { data: parent } = await service
      .from('comments')
      .select('id, version_id, parent_id, deleted_at')
      .eq('id', parentId)
      .maybeSingle();
    const prow = parent as unknown as { id: string; version_id: string; parent_id: string | null; deleted_at: string | null } | null;
    if (!prow || prow.version_id !== versionId || prow.parent_id !== null || prow.deleted_at !== null) {
      return errorRes(400, 'invalid_input', 'Некоректна гілка відповіді.');
    }
  }

  const insert = {
    project_id: project.id,
    version_id: versionId,
    parent_id: parentId ?? null,
    author_name: authorName,
    author_role: 'reviewer' as const,
    author_user_id: null,
    body: text,
    timestamp_seconds: Math.round(timestampSeconds * 1000) / 1000,
  };
  const { data: created, error: insertErr } = await service
    .from('comments')
    .insert(insert)
    .select('id, parent_id, author_name, author_role, body, timestamp_seconds, status, created_at, updated_at')
    .single();
  if (insertErr || !created) {
    console.error('insert comment error', insertErr?.message);
    return errorRes(500, 'internal_error', 'Не вдалося зберегти коментар.');
  }
  const c = created as unknown as CommentRow;
  return json(200, {
    id: c.id,
    parentId: c.parent_id,
    authorName: c.author_name,
    authorRole: c.author_role,
    body: c.body,
    timestampSeconds: Number(c.timestamp_seconds),
    status: c.status,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  });
});
