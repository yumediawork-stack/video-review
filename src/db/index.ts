import { isMockMode } from '../lib/config';
import { liveAdminApi } from './live';
import { mockAdminApi } from './mock';
import type { AdminDataApi } from './types';

export const adminApi: AdminDataApi = isMockMode() ? mockAdminApi : liveAdminApi;
export { isMockMode as isMock } from '../lib/config';
export { resetMockData } from './mock';
export { uploadVideoToStorage, buildStoragePath } from './upload';
export type { AdminDataApi, UploadHandle, VersionDraftMeta } from './types';
export { MOCK_REVIEW_TOKEN } from './mock';
