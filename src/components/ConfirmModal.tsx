import { useEffect } from 'react';

/** Просте модальне вікно з підтвердженням (доступність: Esc закриває, фокус на кнопку). */
export default function ConfirmModal({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Скасувати',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title} onClick={onCancel}>
      <div className="vr-card w-full max-w-md p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-ink-muted">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="vr-btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={`vr-btn ${danger ? 'vr-btn-danger' : 'vr-btn-accent'}`} onClick={onConfirm} disabled={busy}>
            {busy && <span className="vr-spinner inline-block h-4 w-4 rounded-full border-2 border-white/60 border-t-transparent" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
