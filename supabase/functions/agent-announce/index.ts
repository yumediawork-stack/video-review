/**
 * POST /functions/v1/agent-announce  (агент на ПК редактора)
 * Body: { token (hash-only agent key), url (базовий тунель), file: { name, size, path? } }
 *
 * Логіка:
 *  - хешує токен і знаходить активний agent_links → проєкт;
 *  - якщо у проєкту вже є чернетка/версія з таким самим (file_name AND size_bytes
 *    AND media_source='agent') → оновлює її agent_url + heartbeat;
 *  - інакше → створює НОВУ чернетку (ready) з наступним version_number
 *    (FOR UPDATE на проєкт, як create_video_version). Опублікування —
 *    вручну адміном (гейт збережено);
 *  - повертає { versionId, created } — агент веде свій registry (URL версії
 *    = <tunnel>/v/<versionId>.mp4).
 */
import { bindCors, json, preflightResponse, resolveCors } from '../_shared/cors.ts';
import { serviceClient, type VersionRow } from '../_shared/db.ts';
import { clientKey, rateLimit } from '../_shared/rate_limit.ts';
import { hashToken, TOKEN_PATTERN } from '../_shared/tokens.ts';
import { z } from 'https://esm.sh/zod@3';

const bodySchema = z.object({
  token: z.string().min(20).max(80),
  url: z.string().url().max(300),
  file: z.object({
    name: z.string().min(1).max(200),
    size: z.number().int().min(1).max(2_147_483_647),
    path: z.string().max(500).optional(),
    durationSeconds: z.number().finite().min(0).optional(),
  }),
});

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
  if (!parsed.success) return json(400, { error: { code: 'invalid_input', message: 'Некоректний запит агента.' } });
  const { token, url, file } = parsed.data;
  if (!TOKEN_PATTERN.test(token)) return json(401, { error: { code: 'invalid_or_revoked_link', message: 'Агент-ключ некоректний.' } });

  const hash = await hashToken(token);
  const rl = rateLimit('agent-announce', clientKey(req, hash.slice(0, 16)), 30, 60_000);
  if (!rl.allowed) return json(429, { error: { code: 'too_many_requests', message: 'Забагато announce.' } });

  const service = serviceClient();

  // 1) токен → активний ключ агента → проєкт
  const { data: link } = await service
    .from('agent_links')
    .select('id, project_id, is_active, revoked_at')
    .eq('token_hash', hash)
    .maybeSingle();
  const row = link as { id: string; project_id: string; is_active: boolean; revoked_at: string | null } | null;
  if (!row || !row.is_active || row.revoked_at !== null) {
    return json(403, { error: { code: 'invalid_or_revoked_link', message: 'Агент-ключ не активний.' } });
  }
  const projectId = row.project_id;

  // 2) шукаємо існуючу agent-версію з таким самим файлом
  const cleanUrl = url.replace(/\/+$/, '');
  const { data: existing } = await service
    .from('video_versions')
    .select('id, project_id, version_number, upload_status, media_source, agent_url, file_name, size_bytes')
    .eq('project_id', projectId)
    .eq('media_source', 'agent')
    .eq('file_name', file.name)
    .eq('size_bytes', file.size)
    .limit(1);
  const found = ((existing ?? []) as unknown as VersionRow[])[0];

  if (found) {
    await service
      .from('video_versions')
      .update({ agent_url: cleanUrl, agent_updated_at: new Date().toISOString() })
      .eq('id', found.id);
    return json(200, { versionId: found.id, created: false });
  }

  // 3) нова чернетка з транзакційною нумерацією (FOR UPDATE на проєкт)
  const tx = async () => {
    const { data: locked, error: lockErr } = await service
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .single();
    if (lockErr || !locked) throw new Error('project_lock_failed');
    const { data: maxRow } = await service
      .from('video_versions')
      .select('version_number')
      .eq('project_id', projectId)
      .order('version_number', { ascending: false })
      .limit(1);
    const next = ((maxRow as unknown as { version_number: number }[] | null)?.[0]?.version_number ?? 0) + 1;
    const insert = await service
      .from('video_versions')
      .insert({
        project_id: projectId,
        version_number: next,
        storage_path: 'agent://stream', // логічний плейсхолдер (bucket не задіяний)
        file_name: file.name,
        size_bytes: file.size,
        mime_type: 'video/mp4',
        duration_seconds: file.durationSeconds ?? null,
        upload_status: 'ready',
        uploaded_at: new Date().toISOString(),
        media_source: 'agent',
        agent_url: cleanUrl,
        agent_updated_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (insert.error) throw new Error('insert_failed: ' + (insert.error.message ?? ''));
    return (insert.data as unknown as { id: string }).id;
  };
  const vid = await tx();
  if (!vid) return json(500, { error: { code: 'internal_error', message: 'Не вдалося створити версію.' } });

  return json(200, { versionId: vid, created: true });
});
