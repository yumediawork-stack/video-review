/**
 * Прогресивний (не імітований) upload у приватний bucket Supabase Storage
 * через XHR: справжні події прогресу, відміна і retry.
 */
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../lib/config';
import { getSupabase } from '../lib/supabase';
import type { UploadHandle } from './types';

export function sanitizeFileName(name: string): string {
  const base = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '-').slice(-80);
  return base.length > 0 ? base : 'video.mp4';
}

export function buildStoragePath(projectId: string, versionId: string, fileName: string): string {
  const stamp = Date.now().toString(36);
  return `${projectId}/${versionId}/${stamp}-${sanitizeFileName(fileName)}`;
}

export function uploadVideoToStorage(storagePath: string, file: File, onProgress?: (ratio: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<void>((resolve, reject) => {
    void (async () => {
      let token: string;
      try {
        const session = (await getSupabase().auth.getSession()).data.session;
        if (!session) throw new Error('Сесія не знайдена. Увійдіть повторно.');
        token = session.access_token;
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }

      xhr.open('POST', `${SUPABASE_URL}/storage/v1/object/review-videos/${storagePath}`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('apikey', SUPABASE_PUBLISHABLE_KEY);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('x-upsert', 'false');

      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && onProgress) onProgress(ev.loaded / ev.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        let detail = '';
        try {
          detail = JSON.parse(xhr.responseText)?.message ?? '';
        } catch {
          /* not json */
        }
        reject(new Error(`Помилка upload (HTTP ${xhr.status})${detail ? `: ${detail}` : ''}`));
      };
      xhr.onerror = () => reject(new Error('Мережева помилка під час upload.'));
      xhr.onabort = () => reject(new DOMException('Upload відмінено', 'AbortError'));
      xhr.send(file);
    })();
  });

  return {
    promise,
    cancel: () => {
      if (xhr.readyState !== 0 && xhr.readyState !== 4) xhr.abort();
    },
  };
}
