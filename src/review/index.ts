import { isMockMode } from '../lib/config';
import { liveReviewApi } from './live';
import { mockReviewApi } from './mock';
import type { ReviewApi } from './types';

export const reviewApi: ReviewApi = isMockMode() ? mockReviewApi : liveReviewApi;
export type { ReviewApi, FlatCommentLike } from './types';
