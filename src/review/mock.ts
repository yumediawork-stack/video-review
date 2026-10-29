/** Mock-реалізація гостьового review API (демо-режим). */
import { ApiError, type NewReviewCommentPayload, type ReviewAccess } from '../lib/types';
import { MOCK_REVIEW_TOKEN } from '../db/mock';
import type { FlatCommentLike, ReviewApi } from './types';

const BASE_URL: string = import.meta.env.BASE_URL ?? '/';
const demoVideoUrl = `${BASE_URL}demo/demo-video.mp4`;

interface MockState {
  projects: Array<{ id: string; title: string; description: string | null; publishedVersionId: string | null; linkActive: boolean; linkToken: string | null }>;
  versions: Array<{ id: string; projectId: string; versionNumber: number; uploadStatus: string; durationSeconds: number | null; mediaUrl: string }>;
  comments: Array<{
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
  }>;
}

const STORE_KEY = 'vr_mock_state_v1';

function load(): MockState {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as MockState;
  } catch {
    /* fallthrough */
  }
  throw new ApiError('no_published_version', 404, 'Mock-стані не знайдено. Відкрийте адмінку, щоб ініціалізувати демо-дані.');
}

function delay<T>(value: T, ms = 120): Promise<T> {
  return new Promise((r) => window.setTimeout(() => r(value), ms));
}

function toFlat(c: MockState['comments'][number]): FlatCommentLike {
  return {
    id: c.id,
    parentId: c.parentId,
    authorName: c.authorName,
    authorRole: c.authorRole,
    body: c.body,
    timestampSeconds: c.timestampSeconds,
    status: c.status,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export const mockReviewApi: ReviewApi = {
  async read(token) {
    const s = load();
    const project = s.projects.find((p) => p.linkActive && (p.linkToken === token || token === MOCK_REVIEW_TOKEN));
    if (!project) throw new ApiError('invalid_or_revoked_link', 403, 'Посилання більше не активне.');
    const version = s.versions.find((v) => v.id === project.publishedVersionId && v.uploadStatus === 'ready');
    if (!version) throw new ApiError('no_published_version', 404, 'Відео ще не опубліковано.');
    const comments = s.comments
      .filter((c) => c.versionId === version.id && !c.deletedAt)
      .map(toFlat);
    return delay<ReviewAccess>({
      projectTitle: project.title,
      projectDescription: project.description,
      version: { id: version.id, number: version.versionNumber, durationSeconds: version.durationSeconds },
      video: { url: version.mediaUrl, expiresAt: null },
      comments,
      revision: version.id,
    });
  },

  async comment(token, payload: NewReviewCommentPayload) {
    const s = load();
    const project = s.projects.find((p) => p.linkActive && (p.linkToken === token || token === MOCK_REVIEW_TOKEN));
    if (!project) throw new ApiError('invalid_or_revoked_link', 403, 'Посилання більше не активне.');
    if (project.publishedVersionId !== payload.versionId) {
      throw new ApiError('version_changed', 409, 'Доступна нова версія. Оновіть відео.');
    }
    if (payload.parentId) {
      const parent = s.comments.find((c) => c.id === payload.parentId);
      if (!parent || parent.versionId !== payload.versionId || parent.parentId) {
        throw new ApiError('invalid_input', 400, 'Некоректна гілка відповіді.');
      }
    }
    const id = `cm-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const c: MockState['comments'][number] = {
      id,
      projectId: project.id,
      versionId: payload.versionId,
      parentId: payload.parentId ?? null,
      authorName: payload.authorName,
      authorRole: 'reviewer',
      body: payload.text,
      timestampSeconds: payload.timestampSeconds,
      status: 'open',
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    s.comments.push(c);
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
    return delay(toFlat(c));
  },

  async refreshVideoUrl(token, versionId) {
    return (async () => {
      const s = load();
      const project = s.projects.find((p) => p.linkActive && (p.linkToken === token || token === MOCK_REVIEW_TOKEN));
      if (!project) throw new ApiError('invalid_or_revoked_link', 403, 'Посилання більше не активне.');
      if (project.publishedVersionId !== versionId) throw new ApiError('version_changed', 409, 'Доступна нова версія.');
      const version = s.versions.find((v) => v.id === versionId);
      if (!version) throw new ApiError('not_found', 404);
      return delay({ url: version.mediaUrl, expiresAt: null });
    })();
  },
};
