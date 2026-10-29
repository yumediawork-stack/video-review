import type { ProjectSummary, VersionInfo, FlatComment, ReviewLinkState, CommentStatus } from '../lib/types';

export interface VersionDraftMeta {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  durationSeconds: number | null;
}

export interface AdminDataApi {
  /** Проєкти */
  getCurrentUserId(): Promise<string>;
  listProjects(): Promise<ProjectSummary[]>;
  getProjectMeta(projectId: string): Promise<{ id: string; title: string; description: string | null; archivedAt: string | null }>;
  createProject(title: string, description?: string | null): Promise<{ id: string }>;
  renameProject(projectId: string, title: string): Promise<void>;
  setProjectDescription(projectId: string, description: string | null): Promise<void>;
  setProjectArchived(projectId: string, archived: boolean): Promise<void>;

  /** Версії */
  listVersions(projectId: string): Promise<VersionInfo[]>;
  /** Створює draft-версію (RPC, транзакційна нумерація). Повертає id та шлях сховища. */
  createVersionDraft(projectId: string, meta: VersionDraftMeta): Promise<{ id: string; storagePath: string }>;
  getVideoUrl(projectId: string, versionId: string): Promise<string | null>;
  /** Після успішного upload: сервер ще раз перевіряє наявність об'єкта в bucket. */
  markUploadReady(versionId: string): Promise<void>;
  markUploadFailed(versionId: string): Promise<void>;
  /** Атомарна публікація: published_version_id → ця версія. */
  publishVersion(projectId: string, versionId: string): Promise<void>;

  /** Гостьове посилання */
  getReviewLink(projectId: string): Promise<ReviewLinkState>;
  /** Останнє активне посилання. */
  createOrRotateReviewLink(projectId: string): Promise<string>; // raw token, повертається лише один раз
  revokeReviewLinks(projectId: string): Promise<void>;

  /** Агент-трансляція: ключ для локального агента (hash-only на сервері). */
  getAgentState(projectId: string): Promise<{ active: boolean }>;
  createAgentKey(projectId: string): Promise<string>; // raw token один раз
  revokeAgentKey(projectId: string): Promise<void>;

  /** Коментарі (адмін, під RLS) */
  listAdminComments(projectId: string, versionId: string): Promise<FlatComment[]>;
  addAdminComment(
    projectId: string,
    versionId: string,
    payload: { authorName: string; body: string; timestampSeconds: number; parentId?: string | null },
  ): Promise<FlatComment>;
  setCommentStatus(commentId: string, status: CommentStatus): Promise<void>;
  /** М'яке видалення (deleted_at), документуємо в docs. */
  deleteComment(commentId: string): Promise<void>;
}

export interface UploadHandle {
  promise: Promise<void>;
  cancel(): void;
}
