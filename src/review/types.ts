import type { NewReviewCommentPayload, ReviewAccess } from '../lib/types';

/** Гостьовий API (без логіну; авторизація — bearer review-токен у body). */
export interface ReviewApi {
  read(token: string): Promise<ReviewAccess>;
  comment(token: string, payload: NewReviewCommentPayload): Promise<FlatCommentLike>;
  refreshVideoUrl(token: string, versionId: string): Promise<{ url: string; expiresAt: string | null }>;
}

/** Мінімальна форма нового коментаря (FlatComment без status/updatedAt спрощень не робимо). */
export interface FlatCommentLike {
  id: string;
  parentId: string | null;
  authorName: string;
  authorRole: 'admin' | 'reviewer';
  body: string;
  timestampSeconds: number;
  status: 'open' | 'resolved';
  createdAt: string;
  updatedAt: string;
}
