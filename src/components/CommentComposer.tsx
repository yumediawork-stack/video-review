import { useEffect, useRef, useState } from 'react';
import { formatTimecode, parseTimecode } from '../lib/timecode';
import { validateAuthorName, validateCommentText, validateTimestampSeconds } from '../lib/validations';

const NAME_KEY = 'vr_author_name';

export interface CommentComposerProps {
  /** Отримати поточний час плеєра (сек). */
  getCurrentTime: () => number;
  /** Час, «зафіксований» під час відкриття форми (сек). */
  initialTime?: number;
  /** Час відповіді = час батьківського коментаря (редагування заблоковано). */
  lockedTime?: number | null;
  defaultAuthor?: string;
  submitLabel?: string;
  busy?: boolean;
  error?: string | null;
  /** Управляваний текст чернетки (необов'язково — для збереження при 409). */
  text?: string;
  onTextChange?: (value: string) => void;
  onSubmit(payload: { authorName: string; text: string; timestampSeconds: number }): void;
  onCancel?: () => void;
  compact?: boolean;
}

/**
 * Форма коментаря. Час фіксується при відкритті; є кнопка
 * «Взяти поточний таймкод». Ім'я зберігається у localStorage
 * (нечутлива personalization, секретам там немає місця).
 */
export default function CommentComposer({
  getCurrentTime,
  initialTime,
  lockedTime = null,
  defaultAuthor = '',
  submitLabel = 'Надіслати',
  busy = false,
  error = null,
  text: controlledText,
  onTextChange,
  onSubmit,
  onCancel,
  compact = false,
}: CommentComposerProps) {
  const [name, setName] = useState(defaultAuthor || safeGetName());
  const [internalText, setInternalText] = useState('');
  const text = controlledText ?? internalText;
  const setText = (v: string) => {
    setInternalText(v);
    onTextChange?.(v);
  };
  const [timestamp, setTimestamp] = useState<number>(lockedTime ?? initialTime ?? getCurrentTime());
  const [fieldError, setFieldError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (lockedTime != null) setTimestamp(lockedTime);
  }, [lockedTime]);

  function safeGetName(): string {
    try {
      return localStorage.getItem(NAME_KEY) ?? '';
    } catch {
      return '';
    }
  }

  function takeCurrentTime() {
    setTimestamp(Math.max(0, getCurrentTime()));
  }

  function submit() {
    const nameRes = validateAuthorName(name);
    const textRes = validateCommentText(text);
    const tsRes = validateTimestampSeconds(timestamp, null);
    if (!nameRes.ok) {
      setFieldError(nameRes.error);
      return;
    }
    if (!textRes.ok) {
      setFieldError(textRes.error);
      return;
    }
    if (!tsRes.ok) {
      setFieldError(tsRes.error);
      return;
    }
    setFieldError(null);
    try {
      localStorage.setItem(NAME_KEY, nameRes.value);
    } catch {
      /* ignore */
    }
    onSubmit({ authorName: nameRes.value, text: textRes.value, timestampSeconds: tsRes.value });
  }

  return (
    <div className={compact ? 'vr-card p-3' : 'vr-card p-4'}>
      <div className={compact ? 'flex flex-col gap-2' : 'grid gap-3 sm:grid-cols-[minmax(140px,180px)_1fr]'}>
        <div>
          <label className="vr-label" htmlFor="composer-name">
            Ваше ім’я <span className="text-ink-muted/60">(запам’ятовується)</span>
          </label>
          <input
            id="composer-name"
            className="vr-input"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Напр., Марія"
            autoComplete="name"
          />
        </div>
        <div className="flex flex-col">
          <span className="vr-label">Час коментаря</span>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded bg-ink-raised px-2 py-1 font-mono text-xs text-ink-accent-strong">{formatTimecode(timestamp)}</code>
            {!lockedTime && (
              <button type="button" className="vr-btn px-2 py-1 text-xs" onClick={takeCurrentTime}>
                Взяти поточний таймкод
              </button>
            )}
            {!lockedTime && (
              <input
                type="text"
                className="w-24 rounded border border-ink-line bg-[#0F1218] px-2 py-1 text-xs"
                placeholder="01:24"
                aria-label="Ввести таймкод вручну"
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const parsed = parseTimecode((e.target as HTMLInputElement).value);
                  if (parsed != null) {
                    setTimestamp(parsed);
                    (e.target as HTMLInputElement).value = '';
                  } else {
                    setFieldError('Не вдалося розібрати таймкод (формат 01:24 або 00:01:24).');
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>

      <textarea
        ref={textRef}
        className="vr-input mt-3 min-h-[72px] resize-y"
        value={text}
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        placeholder="Що покращити? Напр.: «00:01:24 — переходи зробити плавніше»"
        aria-label="Текст коментаря"
      />

      {(fieldError || error) && (
        <p className="mt-2 text-xs text-ink-danger" role="alert">
          {fieldError ?? error}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        {onCancel && (
          <button type="button" className="vr-btn" onClick={onCancel} disabled={busy}>
            Скасувати
          </button>
        )}
        <button type="button" className="vr-btn vr-btn-accent" onClick={submit} disabled={busy}>
          {busy && <span className="vr-spinner inline-block h-4 w-4 rounded-full border-2 border-white/50 border-t-transparent" />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
