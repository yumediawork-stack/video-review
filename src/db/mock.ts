/**
 * Mock-реалізація адмін-даних: демо-проєкти, відео-заглушка та локальні коментарі.
 * Стан тримається у localStorage під ключем `vr_mock_state_v1`.
 * ВАЖЛИВО: це MOCK, а не production-дані; UI позначає це банером.
 */
import { ApiError, type CommentStatus, type FlatComment, type ProjectSummary, type ReviewLinkState, type VersionInfo } from '../lib/types';
import type { AdminDataApi, VersionDraftMeta } from './types';

const STORE_KEY = 'vr_mock_state_v1';
export const MOCK_REVIEW_TOKEN = 'mock-review-token';

const BASE_URL: string = import.meta.env.BASE_URL ?? '/';
const demoVideoUrl = `${BASE_URL}demo/demo-video.mp4`;

interface MockVersion {
  id: string;
  projectId: string;
  versionNumber: number;
  uploadStatus: 'uploading' | 'draft' | 'ready' | 'failed';
  fileName: string | null;
  sizeBytes: number | null;
  durationSeconds: number | null;
  createdAt: string;
  uploadedAt: string | null;
  mediaUrl: string;
}

interface MockProject {
  id: string;
  title: string;
  description: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  publishedVersionId: string | null;
  linkActive: boolean;
  /** токен активного посилання (MOCK-only: у prod зберігається хеш на сервері) */
  linkToken: string | null;
}

interface MockComment {
  id: string;
  projectId: string;
  versionId: string;
  parentId: string | null;
  authorName: string;
  authorRole: 'admin' | 'reviewer';
  body: string;
  timestampSeconds: number;
  status: 'open' | 'resolved';
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MockState {
  projects: MockProject[];
  versions: MockVersion[];
  comments: MockComment[];
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}
const nowIso = () => new Date().toISOString();
function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function seed(): MockState {
  const projects: MockProject[] = [
    {
      id: 'proj-demo',
      title: 'Демо: реклама кави',
      description: 'Чернетковий монтаж. Тестуємо в mock-режимі.',
      archivedAt: null,
      createdAt: daysAgoIso(5),
      updatedAt: daysAgoIso(0.2),
      publishedVersionId: 'ver-demo-1',
      linkActive: true,
      linkToken: MOCK_REVIEW_TOKEN,
    },
    {
      id: 'proj-draft',
      title: 'Синтезатор заголовків',
      description: null,
      archivedAt: null,
      createdAt: daysAgoIso(2),
      updatedAt: daysAgoIso(1),
      publishedVersionId: null,
      linkActive: true,
      linkToken: MOCK_REVIEW_TOKEN,
    },
    {
      id: 'proj-arch',
      title: 'Архів: титри до подкасту',
      description: null,
      archivedAt: daysAgoIso(9),
      createdAt: daysAgoIso(20),
      updatedAt: daysAgoIso(9),
      publishedVersionId: 'ver-arch-1',
      linkActive: false,
      linkToken: null,
    },
  ];

  const versions: MockVersion[] = [
    { id: 'ver-demo-1', projectId: 'proj-demo', versionNumber: 1, uploadStatus: 'ready', fileName: 'kaffe-v1.mp4', sizeBytes: 42_000_000, durationSeconds: 10, createdAt: daysAgoIso(5), uploadedAt: daysAgoIso(5), mediaUrl: demoVideoUrl },
    { id: 'ver-demo-2', projectId: 'proj-demo', versionNumber: 2, uploadStatus: 'ready', fileName: 'kaffe-v2.mp4', sizeBytes: 43_500_000, durationSeconds: 10, createdAt: daysAgoIso(0.2), uploadedAt: daysAgoIso(0.2), mediaUrl: demoVideoUrl },
    { id: 'ver-arch-1', projectId: 'proj-arch', versionNumber: 1, uploadStatus: 'ready', fileName: 'titles.mp4', sizeBytes: 8_000_000, durationSeconds: 10, createdAt: daysAgoIso(19), uploadedAt: daysAgoIso(19), mediaUrl: demoVideoUrl },
  ];

  const c = (
    o: Partial<MockComment> & Pick<MockComment, 'projectId' | 'versionId' | 'authorName' | 'authorRole' | 'body' | 'timestampSeconds' | 'createdAt'>,
  ): MockComment => ({
    id: uid(),
    parentId: null,
    status: 'open',
    deletedAt: null,
    updatedAt: o.createdAt,
    ...o,
  } as MockComment);

  const comments: MockComment[] = [
    c({ id: 'cm-1', projectId: 'proj-demo', versionId: 'ver-demo-1', authorName: 'Ольга', authorRole: 'reviewer', body: 'Переходи занадто різкі, зроби плавніше.', timestampSeconds: 2, createdAt: daysAgoIso(1) }),
    c({ id: 'cm-2', projectId: 'proj-demo', versionId: 'ver-demo-1', authorName: 'Монтажер', authorRole: 'admin', body: 'Поняв, поправлю в наступній версії.', timestampSeconds: 2, parentId: 'cm-1', createdAt: daysAgoIso(0.9) }),
    c({ id: 'cm-3', projectId: 'proj-demo', versionId: 'ver-demo-1', authorName: 'Іван', authorRole: 'reviewer', body: 'Музика забирає увагу після 33-ї секунди.', timestampSeconds: 6, createdAt: daysAgoIso(0.8) }),
    c({ id: 'cm-4', projectId: 'proj-demo', versionId: 'ver-demo-1', authorName: 'Монтажер', authorRole: 'admin', body: 'Зауваження ухвалене, змінено.', timestampSeconds: 8, status: 'resolved', createdAt: daysAgoIso(0.5) }),
    c({ id: 'cm-5', projectId: 'proj-demo', versionId: 'ver-demo-2', authorName: 'Ольга', authorRole: 'reviewer', body: 'Цей коментар стосується чернетки v2, гостю не видно.', timestampSeconds: 4, createdAt: daysAgoIso(0.1) }),
  ];

  return { projects, versions, comments };
}

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    /* fallthrough → reseed */
  }
  const s = seed();
  save(s);
  return s;
}
function save(s: MockState) {
  localStorage.setItem(STORE_KEY, JSON.stringify(s));
}
function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((r) => window.setTimeout(() => r(value), ms));
}

function toVersionInfo(mock: MockVersion, project: MockProject): VersionInfo {
  const isPublished = project.publishedVersionId === mock.id;
  const viewable = mock.uploadStatus === 'ready' || mock.uploadStatus === 'draft';
  return {
    id: mock.id,
    versionNumber: mock.versionNumber,
    status: isPublished ? 'published' : mock.uploadStatus,
    isPublished,
    fileName: mock.fileName,
    sizeBytes: mock.sizeBytes,
    mimeType: 'video/mp4',
    durationSeconds: mock.durationSeconds,
    createdAt: mock.createdAt,
    uploadedAt: mock.uploadedAt,
    mediaUrl: viewable ? mock.mediaUrl : null,
    mediaSource: 'storage',
    agentBeat: null,
  };
}

export function resetMockData(): void {
  localStorage.removeItem(STORE_KEY);
}

export const mockAdminApi: AdminDataApi = {
  async getCurrentUserId() {
    return 'mock-admin-user';
  },

  async listProjects(): Promise<ProjectSummary[]> {
    const s = load();
    return s.projects.map((p) => {
      const published = s.versions.find((v) => v.id === p.publishedVersionId);
      const ownVersions = s.versions.filter((v) => v.projectId === p.id);
      return {
        id: p.id,
        title: p.title,
        description: p.description,
        archivedAt: p.archivedAt,
        updatedAt: p.updatedAt,
        publishedVersionNumber: published?.versionNumber ?? null,
        openComments: s.comments.filter((c) => c.versionId === p.publishedVersionId && c.status === 'open' && !c.deletedAt).length,
        hasReadyDraft: ownVersions.some((v) => v.uploadStatus === 'ready' && v.id !== p.publishedVersionId),
      };
    });
  },

  async createProject(title, description) {
    const s = load();
    const p: MockProject = {
      id: `proj-${uid().slice(0, 8)}`,
      title,
      description: description ?? null,
      archivedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      publishedVersionId: null,
      linkActive: false,
      linkToken: null,
    };
    s.projects.push(p);
    save(s);
    return delay({ id: p.id });
  },

  async renameProject(projectId, title) {
    const s = load();
    const p = s.projects.find((x) => x.id === projectId);
    if (!p) throw new ApiError('not_found', 404, 'Проєкт не знайдено.');
    p.title = title;
    p.updatedAt = nowIso();
    save(s);
  },

  async setProjectDescription(projectId, description) {
    const s = load();
    const p = s.projects.find((x) => x.id === projectId);
    if (!p) throw new ApiError('not_found', 404, 'Проєкт не знайдено.');
    p.description = description;
    p.updatedAt = nowIso();
    save(s);
  },

  async setProjectArchived(projectId, archived) {
    const s = load();
    const p = s.projects.find((x) => x.id === projectId);
    if (!p) throw new ApiError('not_found', 404, 'Проєкт не знайдено.');
    p.archivedAt = archived ? nowIso() : null;
    p.updatedAt = nowIso();
    save(s);
  },

  async getProjectMeta(projectId) {
    const s = load();
    const p = s.projects.find((x) => x.id === projectId);
    if (!p) throw new ApiError('not_found', 404, 'Проєкт не знайдено.');
    return delay({ id: p.id, title: p.title, description: p.description, archivedAt: p.archivedAt });
  },

  async listVersions(projectId) {
    const s = load();
    const p = s.projects.find((x) => x.id === projectId);
    if (!p) throw new ApiError('not_found', 404, 'Проєкт не знайдено.');
    const versions = s.versions
      .filter((v) => v.projectId === p.id)
      .map((v) => toVersionInfo(v, p))
      .sort((a, b) => a.versionNumber - b.versionNumber);
    return delay(versions);
  },

  async createVersionDraft(projectId, meta: VersionDraftMeta) {
    const s = load();
    const p = s.projects.find((x) => x.id === projectId);
    if (!p) throw new ApiError('not_found', 404, 'Проєкт не знайдено.');
    const nextNumber = s.versions.filter((v) => v.projectId === p.id).reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
    const v: MockVersion = {
      id: `ver-${uid().slice(0, 8)}`,
      projectId: p.id,
      versionNumber: nextNumber,
      uploadStatus: 'uploading',
      fileName: meta.fileName,
      sizeBytes: meta.sizeBytes,
      durationSeconds: meta.durationSeconds,
      createdAt: nowIso(),
      uploadedAt: null,
      mediaUrl: demoVideoUrl,
    };
    s.versions.push(v);
    p.updatedAt = nowIso();
    save(s);
    return delay({ id: v.id, storagePath: `mock://${p.id}/${v.id}/${meta.fileName}` });
  },

  async getVideoUrl(_projectId, versionId) {
    const s = load();
    const v = s.versions.find((x) => x.id === versionId);
    if (!v || v.uploadStatus === 'failed') return null;
    return v.mediaUrl;
  },

  async markUploadReady(versionId) {
    const s = load();
    const v = s.versions.find((x) => x.id === versionId);
    if (!v) throw new ApiError('not_found', 404, 'Версію не знайдено.');
    v.uploadStatus = 'ready';
    v.uploadedAt = nowIso();
    save(s);
  },

  async markUploadFailed(versionId) {
    const s = load();
    const v = s.versions.find((x) => x.id === versionId);
    if (!v) return;
    v.uploadStatus = 'failed';
    save(s);
  },

  async publishVersion(projectId, versionId) {
    const s = load();
    const p = s.projects.find((x) => x.id === projectId);
    const v = s.versions.find((x) => x.id === versionId);
    if (!p || !v || v.projectId !== p.id || v.uploadStatus !== 'ready') {
      throw new ApiError('invalid_input', 400, 'Версія не готова до публікації.');
    }
    p.publishedVersionId = versionId;
    p.updatedAt = nowIso();
    save(s);
  },

  async getReviewLink(projectId): Promise<ReviewLinkState> {
    const s = load();
    const p = s.projects.find((x) => x.id === projectId);
    if (!p) throw new ApiError('not_found', 404, 'Проєкт не знайдено.');
    return { active: p.linkActive, updatedAt: p.updatedAt };
  },

  async createOrRotateReviewLink(projectId) {
    const s = load();
    const p = s.projects.find((x) => x.id === projectId);
    if (!p) throw new ApiError('not_found', 404, 'Проєкт не знайдено.');
    const token = MOCK_REVIEW_TOKEN;
    p.linkActive = true;
    // У mock активний токен зберігається у стані, щоб review-сторінка могла
    // його приймати (у prod raw токен зберігається лише хешем і повертається
    // клієнту рівно один раз).
    p.linkToken = token;
    p.updatedAt = nowIso();
    save(s);
    return delay(token, 80);
  },

  async revokeReviewLinks(projectId) {
    const s = load();
    const p = s.projects.find((x) => x.id === projectId);
    if (!p) throw new ApiError('not_found', 404, 'Проєкт не знайдено.');
    p.linkActive = false;
    save(s);
  },

  async getAgentState() {
    // mock: агент-режим лише у реальному середовищі
    return { active: false };
  },

  async createAgentKey() {
    throw new ApiError('internal_error', 501, 'Трансляція з PC доступна лише у реальному режимі (з Supabase). Завантажте файл або підключіть .env.local.');
  },

  async revokeAgentKey() {
    /* noop у mock */
  },

  async listAdminComments(_projectId, versionId): Promise<FlatComment[]> {
    const s = load();
    const flat: FlatComment[] = s.comments
      .filter((c) => c.versionId === versionId && !c.deletedAt)
      .map((c) => ({
        id: c.id,
        parentId: c.parentId,
        authorName: c.authorName,
        authorRole: c.authorRole,
        body: c.body,
        timestampSeconds: c.timestampSeconds,
        status: c.status,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }));
    return delay(flat, 80);
  },

  async addAdminComment(projectId, versionId, payload) {
    const s = load();
    const c: MockComment = {
      id: uid(),
      projectId,
      versionId,
      parentId: payload.parentId ?? null,
      authorName: payload.authorName,
      authorRole: 'admin',
      body: payload.body,
      timestampSeconds: payload.timestampSeconds,
      status: 'open' as CommentStatus,
      deletedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    s.comments.push(c);
    save(s);
    return delay({
      id: c.id,
      parentId: c.parentId,
      authorName: c.authorName,
      authorRole: c.authorRole,
      body: c.body,
      timestampSeconds: c.timestampSeconds,
      status: c.status,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    } satisfies FlatComment);
  },

  async setCommentStatus(commentId, status) {
    const s = load();
    const c = s.comments.find((x) => x.id === commentId);
    if (!c) throw new ApiError('not_found', 404, 'Коментар не знайдено.');
    c.status = status;
    c.updatedAt = nowIso();
    save(s);
  },

  async deleteComment(commentId) {
    const s = load();
    const c = s.comments.find((x) => x.id === commentId);
    if (!c) return;
    c.deletedAt = nowIso();
    save(s);
  },
};
