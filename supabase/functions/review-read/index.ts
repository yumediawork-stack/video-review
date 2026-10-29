/**
 * POST /functions/v1/review-read
 * Body: { token }
 *
 * Повертає мінімальний набір для review-сторінки: назву/опис проєкту,
 * поточну ОПУБЛІКОВАНУ версію, джерело відео, коментарі (плоский список),
 * opaque revision.
 *
 * Джерела відео:
 *  - storage: короткоживучий signed URL приватного bucket;
 *  - agent: базовий URL тунеля на ПК редактора (media_source='agent');
 *    якщо heartbeat агента свіжий → /v/<versionId>.mp4, інакше offline:true
 *    (коментарі та метадані все одно доступні).
 * Не віддає storage_path, admin-дані, історію версій.
 */
import { json, preflightResponse, resolveCors } from '../_shared/cors.ts';
import { bindCors } from '../_shared/cors.ts';
import { serviceClient, type CommentRow, type ReviewLinkJoined, type VersionRow } from '../_shared/db.ts';
import { clientKey, rateLimit } from '../_shared/rate_limit.ts';
import { hashToken, TOKEN_PATTERN } from '../_shared/tokens.ts';
import { z } from 'https://esm.sh/zod@3';

const SIGNED_URL_TTL = 7200;
const AGENT_ONLINE_WINDOW_MS = 120_000; // heartbeat агента раз/хв → 2 хв = офлайн

const bodySchema = z.object({ token: z.string().min(20).max(80) });

function errorRes(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

type MediaOut = {
  signedUrl: string;
  expiresAt: string | null;
  kind: 'storage' | 'agent';
  offline: boolean;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    const cors = resolveCors(req);
    if (!cors.allowed) return new Response(null, { status: 403 });
    return preflightResponse(cors.headers);
  }
  if (req.method !== 'POST') return errorRes(405, 'invalid_input', 'Метод не підтримується.');
  const cors = resolveCors(req);
  if (!cors.allowed) return errorRes(403, 'cors_rejected', 'Origin не дозволено.');
  bindCors(cors);

  let raw: unknown;
  try { raw = await req.json(); } catch { return errorRes(400, 'invalid_input', 'Некоректний JSON.'); }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return errorRes(400, 'invalid_input', 'Некоректний формат запиту.');
  const token = parsed.data.token;
  if (!TOKEN_PATTERN.test(token)) return errorRes(401, 'invalid_or_revoked_link', 'Посилання некоректне.');

  const hash = await hashToken(token);
  const rl = rateLimit('review-read', clientKey(req, hash.slice(0, 16)), 60, 60_000);
  if (!rl.allowed) return errorRes(429, 'too_many_requests', 'Забагато запитів. Спробуйте пізніше.');

  const service = serviceClient();

  // 1) токен → активне посилання + проєкт
  const { data: link, error: linkErr } = await service
    .from('review_links')
    .select('id, project_id, is_active, revoked_at, projects!inner ( id, title, description, published_version_id, owner_id )')
    .eq('token_hash', hash)
    .maybeSingle();
  if (linkErr) {
    console.error('review-read link error', linkErr.message);
    return errorRes(500, 'internal_error', 'Помилка сервера.');
  }
  const row = link as unknown as ReviewLinkJoined | null;
  if (!row || !row.is_active || row.revoked_at !== null) {
    return errorRes(403, 'invalid_or_revoked_link', 'Посилання більше не активне.');
  }
  const project = row.projects;
  if (!project) return errorRes(404, 'not_found', 'Проєкт не знайдено.');

  // 2) активна ОПУБЛІКОВАНА версія (чернетки гостя недоступні)
  if (!project.published_version_id) return errorRes(404, 'no_published_version', 'Відео ще не опубліковано.');
  const { data: version } = await service
    .from('video_versions')
    .select('id, version_number, storage_path, upload_status, duration_seconds, media_source, agent_url, agent_updated_at')
    .eq('id', project.published_version_id)
    .maybeSingle();
  const vrow = version as unknown as (VersionRow & { media_source: 'storage' | 'agent'; agent_url: string | null; agent_updated_at: string | null }) | null;
  if (!vrow || vrow.upload_status !== 'ready') {
    return errorRes(404, 'no_published_version', 'Відео ще не опубліковано.');
  }

  // 3) джерело відео
  let media: MediaOut;
  if (vrow.media_source === 'agent') {
    const base = (vrow.agent_url ?? '').replace(/\/+$/, '');
    if (!base) return errorRes(404, 'no_published_version', 'Джерело трансляції не налаштоване.');
    const heartbeat = vrow.agent_updated_at ? new Date(vrow.agent_updated_at).getTime() : 0;
    const online = Date.now() - heartbeat < AGENT_ONLINE_WINDOW_MS;
    media = {
      signedUrl: online ? `${base}/v/${vrow.id}.mp4` : '',
      expiresAt: null,
      kind: 'agent',
      offline: !online,
    };
  } else {
    const { data: signed, error: signedErr } = await service
      .storage
      .from('review-videos')
      .createSignedUrl(vrow.storage_path, SIGNED_URL_TTL);
    if (signedErr || !signed) {
      console.error('signed url error', signedErr?.message);
      return errorRes(500, 'internal_error', 'Не вдалося підготувати відео.');
    }
    media = { signedUrl: signed.signedUrl, expiresAt: new Date(Date.now() + SIGNED_URL_TTL * 1000).toISOString(), kind: 'storage', offline: false };
  }

  // 4) коментарі саме цієї версії (видалені — приховані)
  const { data: commentsRaw, error: commentsErr } = await service
    .from('comments')
    .select('id, parent_id, author_name, author_role, body, timestamp_seconds, status, created_at, updated_at')
    .eq('version_id', vrow.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (commentsErr) {
    console.error('comments error', commentsErr.message);
    return errorRes(500, 'internal_error', 'Помилка сервера.');
  }

  const comments = ((commentsRaw ?? []) as unknown as CommentRow[]).map((c) => ({
    id: c.id,
    parentId: c.parent_id,
    authorName: c.author_name,
    authorRole: c.author_role,
    body: c.body,
    timestampSeconds: Number(c.timestamp_seconds),
    status: c.status,
    createdAt: c.created_at,
    updatedAt: c.updated_at,
  }));

  return json(200, {
    project: { title: project.title, description: project.description },
    version: { id: vrow.id, number: vrow.version_number, durationSeconds: vrow.duration_seconds == null ? null : Number(vrow.duration_seconds) },
    video: { signedUrl: media.signedUrl, expiresAt: media.expiresAt, kind: media.kind, offline: media.offline },
    comments,
    revision: vrow.id,
  });
});
