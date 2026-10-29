/** Валідація полів на клієнті (а також дублюється на сервері в Edge Functions). */

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type ValidationOptions = {
  minLength: number;
  maxLength: number;
  fieldLabel: string;
};

export function validateTextField(value: string, opts: ValidationOptions): FieldResult<string> {
  const v = value.trim();
  if (v.length < opts.minLength) {
    return { ok: false, error: `${opts.fieldLabel}: мінімум ${opts.minLength} символ(ів).` };
  }
  if (v.length > opts.maxLength) {
    return { ok: false, error: `${opts.fieldLabel}: максимум ${opts.maxLength} символ(ів).` };
  }
  return { ok: true, value: v };
}

export function validateAuthorName(name: string) {
  return validateTextField(name, { minLength: 1, maxLength: 60, fieldLabel: 'Ваше ім’я' });
}

export function validateCommentText(text: string) {
  return validateTextField(text, { minLength: 1, maxLength: 2000, fieldLabel: 'Текст коментаря' });
}

export function validateTimestampSeconds(seconds: unknown, durationSeconds?: number | null): FieldResult<number> {
  const n = typeof seconds === 'number' ? seconds : Number(seconds);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'Некоректний таймкод.' };
  }
  if (durationSeconds != null && durationSeconds > 0 && n > durationSeconds + 1.5) {
    return { ok: false, error: 'Таймкод виходить за тривалість відео.' };
  }
  return { ok: true, value: n };
}

/** Підтримуваний формат MVP — MP4 (H.264/AAC). Додаткові типи браузер може не відтворити. */
export const ACCEPTED_VIDEO_MIME = ['video/mp4'];

export type FileCheckResult = { ok: true; file: File } | { ok: false; error: string };

export function checkVideoFile(file: File): FileCheckResult {
  const name = file.name.toLowerCase();
  const extOk = name.endsWith('.mp4');
  const mimeOk = file.type ? ACCEPTED_VIDEO_MIME.includes(file.type) : true; // деякі браузери віддають ''
  if (!extOk) {
    return { ok: false, error: 'Підтримується лише файл .mp4 (рекомендовано H.264 + AAC).' };
  }
  if (!mimeOk) {
    return { ok: false, error: `Тип файлу «${file.type}» не підтримується. Експортуйте MP4 (H.264/AAC).` };
  }
  if (file.size <= 0) {
    return { ok: false, error: 'Файл порожній.' };
  }
  return { ok: true, file };
}

/**
 * Попереднє читання тривалості через <video loadedmetadata>.
 * Повертає duration або null (dimensions невідомі — завантаження дозволене,
 * сервер також приймає null duration).
 */
export function probeVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = document.createElement('video');
      el.preload = 'metadata';
      const done = (d: number | null) => {
        URL.revokeObjectURL(url);
        resolve(Number.isFinite(d) && d! > 0 ? d! : null);
      };
      el.onloadedmetadata = () => done(el.duration);
      el.onerror = () => done(null);
      window.setTimeout(() => done(el.duration > 0 ? el.duration : null), 4000);
      el.src = url;
    } catch {
      resolve(null);
    }
  });
}
