import type { ProjectBadgeState } from '../lib/types';

const BADGES: Record<ProjectBadgeState, { label: string; className: string }> = {
  published: { label: 'Опубліковано', className: 'bg-[#16301F] text-ink-success' },
  draft: { label: 'Чернетка', className: 'bg-[#33261A] text-ink-warn' },
  no_video: { label: 'Немає відео', className: 'bg-white/5 text-ink-muted' },
  archived: { label: 'Архів', className: 'bg-white/10 text-ink-muted' },
};

function formatUpdated(iso: string): string {
  try {
    return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function ProjectCard({
  state,
  title,
  updatedAt,
  publishedVersionNumber,
  openComments,
  hasReadyDraft,
  onOpen,
}: {
  state: ProjectBadgeState;
  title: string;
  updatedAt: string;
  publishedVersionNumber: number | null;
  openComments: number;
  hasReadyDraft: boolean;
  onOpen: () => void;
}) {
  const badge = BADGES[state];
  return (
    <button
      type="button"
      onClick={onOpen}
      className="vr-card group flex h-full w-full flex-col items-start gap-2 p-4 text-left transition-colors hover:border-ink-accent/60 hover:bg-ink-raised"
    >
      <div className="flex w-full items-start justify-between gap-2">
        <span className="font-semibold leading-snug group-hover:text-ink-accent-strong">{title}</span>
        <span className={`vr-chip shrink-0 ${badge.className}`}>{badge.label}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <span>Оновлено: {formatUpdated(updatedAt)}</span>
        <span>
          Відкриті коментарі: <b className="text-ink-text">{openComments}</b>
        </span>
        <span>{publishedVersionNumber ? `Опубліковано: v${publishedVersionNumber}` : 'Першого ролика немає'}</span>
        {hasReadyDraft && <span className="text-ink-warn">Є нова чернетка</span>}
      </div>
    </button>
  );
}
