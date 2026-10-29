/**
 * Реальна реалізація адмін-даних на Supabase (RLS + RPC).
 * Не містить жодних секретів: тільки publishable key та JWT користувача.
 * Publish / створення версії / м'яке видалення — через RPC (безпечно, атомарно).
 */
import type { PostgrestError } from '@supabase/supabase-js';
import { getSupabase } from '../lib/supabase';
import { SIGNED_URL_TTL_SECONDS, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../lib/config';
import { ApiError, type ApiErrorCode, type CommentStatus, type FlatComment, type ProjectSummary, type ReviewLinkState, type VersionInfo } from '../lib/types';
import type { AdminDataApi, VersionDraftMeta } from './types';

type ProjectRow = {
  id: string;
  title: string;
  description: string | null;
  archived_at: string | null;
  updated_at: string;
  published_version_id: string | null;
};
type VersionRow = {
  id: string;
  project_id: string;
  version_number: number;
  file_name: string | null;
  size_bytes: string | number | null;
  mime_type: string | null;
  duration_seconds: string | number | null;
  upload_status: 'uploading' | 'draft' | 'ready' | 'failed';
  created_at: string;
  uploaded_at: string | null;
  storage_path: string;
};
type LinkRow = { id: string; project_id: string; is_active: boolean; created_at: string };
type CommentRow = {
  id: string;
  project_id: string;
  version_id: string;
  parent_id: string | null;
  author_name: string;
  author_role: 'admin' | 'reviewer';
  body: string;
  timestamp_seconds: string | number;
  status: 'open' | 'resolved';
  created_at: string;
  updated_at: string;
};

function pgErr(e: PostgrestError): ApiError {
  // Повідомлення залишати корисним, але без внутрішніх деталей (шляхів, таблиць).
  return new ApiError('internal_error', 500, e.message || 'Помилка бази даних.');
}

async function getUserToken(): Promise<string | null> {
  const session = (await getSupabase().auth.getSession()).data.session;
  return session?.access_token ?? null;
}

async function mapVersion(row: VersionRow, publishedVersionId: string | null): Promise<VersionInfo> {
  const isPublished = publishedVersionId === row.id;
  const status = isPublished ? ('published' as const) : row.upload_status;
  return {
    id: row.id,
    versionNumber: row.version_number,
    status,
    isPublished,
    fileName: row.file_name,
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    mimeType: row.mime_type,
    durationSeconds: row.duration_seconds == null ? null : Number(row.duration_seconds),
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at,
    mediaUrl: null,
  };
}

export const liveAdminApi: AdminDataApi = {
  async getCurrentUserId() {
    const { data } = await getSupabase().auth.getUser();
    if (!data.user) throw new ApiError('internal_error', 401, 'Сесію не знайдено.');
    return data.user.id;
  },

  async listProjects(): Promise<ProjectSummary[]> {
    const sb = getSupabase();
    const { data: projects, error } = await sb
      .from('projects')
      .select('id, title, description, archived_at, updated_at, published_version_id')
      .order('updated_at', { ascending: false });
    if (error) throw pgErr(error);
    const rows = projects as unknown as ProjectRow[];

    const { data: versions, error: e2 } = await sb.from('video_versions').select('id, project_id, version_number, upload_status');
    if (e2) throw pgErr(e2);
    const vRows = (versions as unknown as VersionRow[]) ?? [];
    const publishedIds = rows.map((r) => r.published_version_id).filter((x): x is string => !!x);

    let openCountByVersion = new Map<string, number>();
    if (publishedIds.length > 0) {
      const { data: openComments, error: e3 } = await sb
        .from('comments')
        .select('version_id')
        .is('deleted_at', null)
        .eq('status', 'open')
        .in('version_id', publishedIds);
      if (e3) throw pgErr(e3);
      openCountByVersion = ((openComments as unknown as { version_id: string }[]) ?? []).reduce((acc, c) => {
        acc.set(c.version_id, (acc.get(c.version_id) ?? 0) + 1);
        return acc;
      }, new Map<string, number>());
    }

    return rows.map((r) => {
      const publishedVersion = vRows.find((v) => v.id === r.published_version_id);
      const openComments = r.published_version_id ? openCountByVersion.get(r.published_version_id) ?? 0 : 0;
      const hasReadyDraft = vRows.some((v) => v.project_id === r.id && v.upload_status === 'ready' && v.id !== r.published_version_id);
      return {
        id: r.id,
        title: r.title,
        description: r.description,
        archivedAt: r.archived_at,
        updatedAt: r.updated_at,
        publishedVersionNumber: publishedVersion?.version_number ?? null,
        openComments,
        hasReadyDraft,
      };
    });
  },

  async createProject(title, description) {
    const user = await this.getCurrentUserId();
    const { data, error } = await getSupabase()
      .from('projects')
      .insert({ owner_id: user, title, description: description ?? null })
      .select('id')
      .single();
    if (error) throw pgErr(error);
    return { id: (data as unknown as { id: string }).id };
  },

  async renameProject(projectId, title) {
    const { error } = await getSupabase().from('projects').update({ title, updated_at: new Date().toISOString() }).eq('id', projectId);
    if (error) throw pgErr(error);
  },

  async setProjectDescription(projectId, description) {
    const { error } = await getSupabase().from('projects').update({ description, updated_at: new Date().toISOString() }).eq('id', projectId);
    if (error) throw pgErr(error);
  },

  async setProjectArchived(projectId, archived) {
    const { error } = await getSupabase()
      .from('projects')
      .update({ archived_at: archived ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('id', projectId);
    if (error) throw pgErr(error);
  },

  async getProjectMeta(projectId) {
    const { data, error } = await getSupabase()
      .from('projects')
      .select('id, title, description, archived_at')
      .eq('id', projectId)
      .single();
    if (error) throw pgErr(error);
    const row = data as unknown as { id: string; title: string; description: string | null; archived_at: string | null };
    return { id: row.id, title: row.title, description: row.description, archivedAt: row.archived_at };
  },

  async listVersions(projectId) {
    const { data: project, error: e0 } = await getSupabase()
      .from('projects')
      .select('id, title, description, archived_at, updated_at, published_version_id')
      .eq('id', projectId)
      .single();
    if (e0) throw pgErr(e0);
    const publishedVersionId = (project as unknown as ProjectRow).published_version_id;
    const { data: versions, error } = await getSupabase()
      .from('video_versions')
      .select('id, project_id, version_number, file_name, size_bytes, mime_type, duration_seconds, upload_status, created_at, uploaded_at, storage_path')
      .eq('project_id', projectId)
      .order('version_number', { ascending: true });
    if (error) throw pgErr(error);
    const mapped = await Promise.all(
      ((versions as unknown as VersionRow[]) ?? []).map((row) => mapVersion(row, publishedVersionId)),
    );
    return mapped;
  },

  async createVersionDraft(projectId, meta: VersionDraftMeta) {
    const { data, error } = await getSupabase().rpc('create_video_version', {
      p_project_id: projectId,
      p_file_name: meta.fileName,
      p_size_bytes: meta.sizeBytes,
      p_mime_type: meta.mimeType,
      p_duration_seconds: meta.durationSeconds,
    });
    if (error) {
      // unique conflict при одночасному завантаженні → користувач просто повторить
      if (error.code === '23505') {
        throw new ApiError('internal_error', 409, 'Паралельне завантаження зайняло цей номер версії. Спробуйте ще раз.');
      }
      throw pgErr(error);
    }
    const row = data as unknown as { id: string; storage_path: string };
    if (!row?.id) throw new ApiError('internal_error', 500, 'RPC не повернув версію.');
    return { id: row.id, storagePath: row.storage_path };
  },

  async getVideoUrl(projectId, versionId) {
    const { data: version, error } = await getSupabase()
      .from('video_versions')
      .select('storage_path, upload_status')
      .eq('id', versionId)
      .eq('project_id', projectId)
      .single();
    if (error) throw pgErr(error);
    const row = version as unknown as { storage_path: string; upload_status: string };
    if (row.upload_status === 'failed') return null;
    const { data: signed, error: e2 } = await getSupabase()
      .storage.from('review-videos')
      .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
    if (e2 || !signed) return null;
    return signed.signedUrl;
  },

  async markUploadReady(versionId) {
    const { error } = await getSupabase().rpc('set_video_upload_result', { p_version_id: versionId, p_ok: true });
    if (error) throw pgErr(error);
  },

  async markUploadFailed(versionId) {
    const { error } = await getSupabase().rpc('set_video_upload_result', { p_version_id: versionId, p_ok: false });
    if (error) throw pgErr(error);
  },

  async publishVersion(projectId, versionId) {
    const { error } = await getSupabase().rpc('publish_version', { p_project_id: projectId, p_version_id: versionId });
    if (error) throw pgErr(error);
  },

  async getReviewLink(projectId): Promise<ReviewLinkState> {
    const { data, error } = await getSupabase()
      .from('review_links')
      .select('id, project_id, is_active, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw pgErr(error);
    const row = ((data as unknown as LinkRow[]) ?? [])[0];
    if (!row) return { active: false, updatedAt: null };
    return { active: row.is_active, updatedAt: row.created_at };
  },

  async createOrRotateReviewLink(projectId) {
    const token = await getUserToken();
    if (!token) throw new ApiError('internal_error', 401, 'Сесію не знайдено.');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/rotate-review-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ projectId, action: 'create' }),
    });
    const body = (await res.json().catch(() => ({}))) as { token?: string; error?: { code: ApiErrorCode; message?: string } };
    if (!res.ok || !body.token) {
      throw new ApiError(body.error?.code ?? 'internal_error', res.status, body.error?.message ?? 'Не вдалося створити посилання.');
    }
    return body.token;
  },

  async revokeReviewLinks(projectId) {
    const token = await getUserToken();
    if (!token) throw new ApiError('internal_error', 401, 'Сесію не знайдено.');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/rotate-review-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ projectId, action: 'revoke' }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new ApiError('internal_error', res.status, body.error?.message ?? 'Не вдалося відкликати посилання.');
    }
  },

  async listAdminComments(_projectId, versionId): Promise<FlatComment[]> {
    const { data, error } = await getSupabase()
      .from('comments')
      .select(
        'id, project_id, version_id, parent_id, author_name, author_role, body, timestamp_seconds, status, created_at, updated_at',
      )
      .eq('version_id', versionId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true });
    if (error) throw pgErr(error);
    const rows = (data as unknown as CommentRow[]) ?? [];
    return rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      authorName: r.author_name,
      authorRole: r.author_role,
      body: r.body,
      timestampSeconds: Number(r.timestamp_seconds),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  },

  async addAdminComment(projectId, versionId, payload) {
    const user = await this.getCurrentUserId();
    const { data, error } = await getSupabase()
      .from('comments')
      .insert({
        project_id: projectId,
        version_id: versionId,
        parent_id: payload.parentId ?? null,
        author_name: payload.authorName,
        author_role: 'admin',
        author_user_id: user,
        body: payload.body,
        timestamp_seconds: payload.timestampSeconds,
      })
      .select(
        'id, project_id, version_id, parent_id, author_name, author_role, body, timestamp_seconds, status, created_at, updated_at',
      )
      .single();
    if (error) throw pgErr(error);
    const r = data as unknown as CommentRow;
    return {
      id: r.id,
      parentId: r.parent_id,
      authorName: r.author_name,
      authorRole: r.author_role,
      body: r.body,
      timestampSeconds: Number(r.timestamp_seconds),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  },

  async setCommentStatus(commentId, status: CommentStatus) {
    const { error } = await getSupabase().rpc('set_comment_status', { p_comment_id: commentId, p_status: status });
    if (error) throw pgErr(error);
  },

  async deleteComment(commentId) {
    const { error } = await getSupabase().rpc('delete_comment', { p_comment_id: commentId });
    if (error) throw pgErr(error);
  },
};
