/** Спільні типи фронтенду (адмін + гостьовий review). */

export type AuthorRole = 'admin' | 'reviewer';
export type CommentStatus = 'open' | 'resolved';

export type ProjectBadgeState = 'published' | 'draft' | 'no_video' | 'archived';

/** Вузол коментарів у дереві: корінь + відповіді. */
export interface CommentNode {
  id: string;
  parentId: string | null;
  authorName: string;
  authorRole: AuthorRole;
  body: string;
  /** Час у секундах з дробовою частиною. */
  timestampSeconds: number;
  status: CommentStatus;
  createdAt: string; // ISO-8601
  updatedAt: string;
  replies: CommentNode[];
}

/** Плоский коментар, як його серіалізує сервер (Edge Function) або БД. */
export interface FlatComment {
  id: string;
  parentId: string | null;
  authorName: string;
  authorRole: AuthorRole;
  body: string;
  timestampSeconds: number;
  status: CommentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: string;
  title: string;
  description: string | null;
  archivedAt: string | null;
  updatedAt: string;
  publishedVersionNumber: number | null;
  openComments: number;
  hasReadyDraft: boolean;
}

export type VersionStatus = 'uploading' | 'draft' | 'ready' | 'failed' | 'published';

export interface VersionInfo {
  id: string;
  versionNumber: number;
  /** Готовність медіа; published показує, що саме ця версія — активна. */
  status: VersionStatus;
  isPublished: boolean;
  fileName: string | null;
  sizeBytes: number | null;
  mimeType: string | null;
  durationSeconds: number | null;
  createdAt: string;
  uploadedAt: string | null;
  /** Підписана URL (адмін), null для failed/uploading. */
  mediaUrl: string | null;
}

export interface ReviewLinkState {
  active: boolean;
  updatedAt: string | null;
}

export interface ReviewAccess {
  projectTitle: string;
  projectDescription: string | null;
  version: { id: string; number: number; durationSeconds: number | null };
  video: { url: string; expiresAt: string | null };
  comments: FlatComment[];
  /** Opaque ідентифікатор опублікованої версії — для детекції нової версії. */
  revision: string;
}

export interface NewReviewCommentPayload {
  versionId: string;
  authorName: string;
  text: string;
  timestampSeconds: number;
  parentId?: string | null;
}

/** Коди помилок серверної частини (задокументовані в docs/ARCHITECTURE.md). */
export type ApiErrorCode =
  | 'invalid_input'
  | 'invalid_or_revoked_link'
  | 'no_published_version'
  | 'not_found'
  | 'version_changed'
  | 'too_many_requests'
  | 'internal_error'
  | 'cors_rejected';

export class ApiError extends Error {
  code: ApiErrorCode;
  status: number;

  constructor(code: ApiErrorCode, status: number, message?: string) {
    super(message ?? code);
    this.code = code;
    this.status = status;
    this.name = 'ApiError';
  }
}
