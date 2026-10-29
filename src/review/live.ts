/**
 * Live-реалізація гостьового API через Supabase Edge Functions.
 * Токен НІКОЛИ не передається в query-рядку — тільки в JSON body
 * (щоб не осідав у server logs).
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../lib/config';
import { ApiError, type ApiErrorCode, type NewReviewCommentPayload, type ReviewAccess } from '../lib/types';
import type { FlatCommentLike, ReviewApi } from './types';

type ErrBody = { error?: { code?: string; message?: string } };

async function callEdge<T>(name: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('internal_error', 0, 'Не вдалося з’єднатися із сервером. Перевірте інтернет.');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-json */
  }
  if (!res.ok) {
    const err = (json as ErrBody | null)?.error;
    const code = (err?.code as ApiErrorCode | undefined) ?? 'internal_error';
    throw new ApiError(code, res.status, err?.message && err.message !== code ? err.message : localizedMessage(code, res.status));
  }
  return json as T;
}

function localizedMessage(code: string, status: number): string {
  switch (code) {
    case 'invalid_or_revoked_link':
      return 'Посилання більше не активне.';
    case 'no_published_version':
      return 'Відео ще не опубліковано.';
    case 'version_changed':
      return 'Доступна нова версія. Оновіть відео, щоб коментувати актуальну.';
    case 'invalid_input':
      return 'Некоректні дані форми.';
    case 'too_many_requests':
      return 'Замто багато запитів. Спробуйте за хвилину.';
    default:
      return status >= 500 ? 'Помилка сервера. Спробуйте пізніше.' : 'Не вдалося виконати запит.';
  }
}

interface ReadPayload {
  project: { title: string; description: string | null };
  version: { id: string; number: number; durationSeconds: number | null };
  video: { signedUrl: string; expiresAt: string | null; kind?: 'storage' | 'agent'; offline?: boolean };
  comments: FlatCommentLike[];
  revision: string;
}

export const liveReviewApi: ReviewApi = {
  async read(token) {
    const data = await callEdge<ReadPayload>('review-read', { token });
    return {
      projectTitle: data.project.title,
      projectDescription: data.project.description,
      version: data.version,
      video: {
        url: data.video.signedUrl,
        expiresAt: data.video.expiresAt ?? null,
        kind: data.video.kind === 'agent' ? 'agent' : 'storage',
        offline: data.video.offline === true,
      },
      comments: data.comments ?? [],
      revision: data.revision,
    };
  },

  async comment(token, payload: NewReviewCommentPayload) {
    return callEdge<FlatCommentLike>('review-comment', {
      token,
      versionId: payload.versionId,
      parentId: payload.parentId ?? null,
      authorName: payload.authorName,
      text: payload.text,
      timestampSeconds: payload.timestampSeconds,
    });
  },

  async refreshVideoUrl(token, versionId) {
    const data = await callEdge<{ signedUrl: string; expiresAt: string | null }>('review-refresh-video-url', { token, versionId });
    return { url: data.signedUrl, expiresAt: data.expiresAt ?? null };
  },
};
