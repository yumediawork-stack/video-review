import type { VersionInfo } from '../lib/types';

function statusInfo(v: VersionInfo): { label: string; className: string } {
  if (v.isPublished) return { label: `Published`, className: 'bg-[#16301F] text-ink-success' };
  switch (v.status) {
    case 'uploading':
      return { label: 'Завантаження…', className: 'bg-white/5 text-ink-muted' };
    case 'ready':
      return { label: 'Чернетка', className: 'bg-[#33261A] text-ink-warn' };
    case 'failed':
      return { label: 'Помилка', className: 'bg-[#3A222A] text-ink-danger' };
    case 'draft':
      return { label: 'Чернетка', className: 'bg-white/5 text-ink-muted' };
    case 'published':
      return { label: 'Published', className: 'bg-[#16301F] text-ink-success' };
  }
}

export default function VersionSelector({
  versions,
  selectedId,
  onSelect,
}: {
  versions: VersionInfo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Версії відео">
      {versions.length === 0 && <span className="text-xs text-ink-muted">Поки що немає жодної версії.</span>}
      {versions.map((v) => {
        const active = v.id === selectedId;
        const info = statusInfo(v);
        return (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(v.id)}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
              active ? 'border-ink-accent bg-ink-accent/15 text-ink-text' : 'border-ink-line bg-ink-surface text-ink-muted hover:bg-ink-raised'
            }`}
          >
            <span className="font-mono">v{v.versionNumber}</span>
            <span className={`vr-chip ${info.className}`}>{info.label}</span>
          </button>
        );
      })}
    </div>
  );
}
