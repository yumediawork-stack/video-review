import { useRef, useState } from 'react';
import { adminApi } from '../db';
import type { VersionDraftMeta, UploadHandle } from '../db/types';
import { buildStoragePath, uploadVideoToStorage } from '../db/upload';
import { ApiError } from '../lib/types';
import { checkVideoFile, probeVideoDuration } from '../lib/validations';

type Phase = 'idle' | 'probing' | 'uploading' | 'finalizing' | 'error' | 'done';

interface Pending {
  file: File | null;
  versionId: string | null;
  storagePath: string | null;
  handle: UploadHandle | null;
  progress: number;
  error: string | null;
}

/**
 * Завантаження нового MP4: drag-and-drop + file picker, реальний прогрес
 * (XHR), cancel/retry, обробка помилок. Після успіху версія стає ready
 * (чернетка) і НЕ змінює активну опубліковану версію автоматично.
 */
export default function UploadVideo({
  projectId,
  createVersionDraft,
  onCompleted,
}: {
  projectId: string;
  createVersionDraft: (projectId: string, meta: VersionDraftMeta) => Promise<{ id: string; storagePath: string }>;
  /** Викликається після успішного завантаження (перелік версій оновити). */
  onCompleted: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const pending = useRef<Pending>({ file: null, versionId: null, storagePath: null, handle: null, progress: 0, error: null });
  const inputRef = useRef<HTMLInputElement | null>(null);

  function reset() {
    if (phase === 'uploading') return;
    setPhase('idle');
    setProgress(0);
    setError(null);
    setFileName('');
    pending.current = { file: null, versionId: null, storagePath: null, handle: null, progress: 0, error: null };
  }

  async function markReady(versionId: string) {
    // Сервер ще раз перевіряє наявність об'єкта у bucket перед статусом ready.
    await adminApi.markUploadReady(versionId);
  }

  async function markFailed(versionId: string) {
    try {
      await adminApi.markUploadFailed(versionId);
    } catch {
      /* не критично */
    }
  }

  async function startUpload(file: File) {
    const check = checkVideoFile(file);
    if (!check.ok) {
      setPhase('error');
      setError(check.error);
      return;
    }
    setFileName(file.name);
    setPhase('probing');
    const duration = await probeVideoDuration(file); // null — не блокуємо, лише попередні метадані
    setPhase('uploading');
    pending.current.file = file;
    try {
      const created = await createVersionDraft(projectId, {
        fileName: file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'video/mp4',
        durationSeconds: duration,
      });
      const { id, storagePath } = created;
      pending.current.versionId = id;
      pending.current.storagePath = storagePath || buildStoragePath(projectId, id, file.name);

      const handle = uploadVideoToStorage(pending.current.storagePath, file, (ratio) => {
        pending.current.progress = ratio;
        setProgress(ratio);
      });
      pending.current.handle = handle;
      try {
        await handle.promise;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') {
          await markFailed(id);
          setPhase('idle');
          setProgress(0);
          setError(null);
          return;
        }
        throw e;
      }
      setPhase('finalizing');
      await markReady(id);
      setPhase('done');
      onCompleted();
      window.setTimeout(() => {
        setPhase('idle');
        setProgress(0);
        setFileName('');
      }, 1800);
    } catch (e) {
      setPhase('error');
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Неочікувана помилка.';
      pending.current.error = msg;
      setError(msg);
      if (pending.current.versionId) await markFailed(pending.current.versionId);
    }
  }

  function cancel() {
    if (phase === 'uploading' && pending.current.handle) {
      setPhase('probing'); // блокує подвійний cancel; потім XHR-abort поверне idle
      pending.current.handle.cancel();
    }
  }

  const busy = phase === 'probing' || phase === 'uploading' || phase === 'finalizing';

  return (
    <section
      className="vr-card p-4"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (busy) return;
        const f = e.dataTransfer.files?.[0];
        if (f) void startUpload(f);
      }}
      aria-label="Завантаження нового відео"
    >
      <h3 className="text-sm font-semibold">Нове відео (MP4)</h3>
      <p className="mt-1 text-xs text-ink-muted">
        Рекомендація: 1080p, H.264/AAC, 4–8 Мбіт/с. Після завантаження версія — чернетка, публікація вручну.
      </p>

      <div
        className={`mt-3 rounded-lg border border-dashed p-4 text-center text-xs ${
          dragOver ? 'border-ink-accent bg-ink-accent/10' : 'border-ink-line'
        }`}
      >
        {busy ? (
          <div>
            <p className="font-medium">{fileName}</p>
            <div className="mx-auto mt-2 h-2 w-full max-w-xs overflow-hidden rounded bg-white/10">
              <div className="h-full bg-ink-accent transition-[width]" style={{ width: `${Math.round(progress * 100)}%` }} aria-hidden="true" />
            </div>
            <p className="mt-1 text-ink-muted">
              {phase === 'finalizing' ? 'Підтвердження на сервері…' : `Завантаження… ${Math.round(progress * 100)}%`}
            </p>
            <button type="button" className="vr-btn mt-2" onClick={cancel}>
              Скасувати
            </button>
          </div>
        ) : phase === 'error' ? (
          <div>
            <p className="text-ink-danger" role="alert">
              {error}
            </p>
            <p className="mt-1 text-ink-muted">
              Якщо файл надто великий — зменшіть bitrate або розділіть матеріал на частини.
            </p>
            <div className="mt-2 flex justify-center gap-2">
              <button type="button" className="vr-btn" onClick={() => reset()}>
                Очистити
              </button>
              <button type="button" className="vr-btn vr-btn-accent" onClick={() => inputRef.current?.click()}>
                Спробувати ще раз
              </button>
            </div>
          </div>
        ) : phase === 'done' ? (
          <p className="text-ink-success">Завантажено успішно. Версія готова до перегляду як чернетка.</p>
        ) : (
          <div>
            <p>Перетягніть .mp4 файл сюди або</p>
            <button type="button" className="vr-btn vr-btn-accent mt-2" onClick={() => inputRef.current?.click()}>
              Вибрати файл
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".mp4,video/mp4"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void startUpload(f);
                e.currentTarget.value = '';
              }}
            />
          </div>
        )}
      </div>
    </section>
  );
}
