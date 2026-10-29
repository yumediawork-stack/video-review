import { formatTimecode } from '../lib/timecode';
import type { CommentNode, CommentStatus } from '../lib/types';

export interface CommentListProps {
  roots: CommentNode[];
  /** Click на таймкод: перемотка. */
  onSelectTimecode: (seconds: number) => void;
  /** Можливості модератора (admin). */
  canModerate?: boolean;
  onToggleStatus?: (commentId: string, status: CommentStatus) => void;
  onDelete?: (commentId: string) => void;
  onReply?: (root: CommentNode) => void;
  /** Гілка, якій зараз відкрита форма відповіді. */
  activeReplyRootId?: string | null;
  replySlot?: (root: CommentNode) => React.ReactNode;
}

function roleBadge(role: 'admin' | 'reviewer') {
  return role === 'admin' ? (
    <span className="vr-chip bg-ink-accent/15 text-ink-accent-strong">Монтажер</span>
  ) : (
    <span className="vr-chip bg-white/5 text-ink-muted">Глядач</span>
  );
}

function statusChip(status: CommentStatus) {
  return status === 'resolved' ? (
    <span className="vr-chip bg-[#16301F] text-ink-success">Виконано</span>
  ) : (
    <span className="vr-chip bg-[#33261A] text-ink-warn">Відкритий</span>
  );
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function CommentList({
  roots,
  onSelectTimecode,
  canModerate = false,
  onToggleStatus,
  onDelete,
  onReply,
  activeReplyRootId,
  replySlot,
}: CommentListProps) {
  if (roots.length === 0) {
    return (
      <div className="vr-card p-6 text-center text-sm text-ink-muted">
        Коментарів поки немає. Натисніть «Залишити коментар», щоб додати перший щодо таймкоду.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {roots.map((root) => (
        <li key={root.id} className={`vr-card p-3 ${root.status === 'resolved' ? 'opacity-70' : ''}`}>
          <CommentBody
            node={root}
            onSelectTimecode={onSelectTimecode}
            canModerate={canModerate}
            onToggleStatus={onToggleStatus}
            onDelete={onDelete}
            onReply={onReply}
            isRoot
          />
          {root.replies.length > 0 && (
            <ul className="mt-2 flex flex-col gap-2 border-l border-ink-line pl-3">
              {root.replies.map((r) => (
                <li key={r.id}>
                  <CommentBody
                    node={r}
                    onSelectTimecode={onSelectTimecode}
                    canModerate={canModerate}
                    onToggleStatus={onToggleStatus}
                    onDelete={onDelete}
                    isRoot={false}
                  />
                </li>
              ))}
            </ul>
          )}
          {activeReplyRootId === root.id && replySlot ? <div className="mt-3">{replySlot(root)}</div> : null}
        </li>
      ))}
    </ul>
  );
}

function CommentBody({
  node,
  onSelectTimecode,
  canModerate,
  onToggleStatus,
  onDelete,
  onReply,
  isRoot,
}: {
  node: CommentNode;
  onSelectTimecode: (seconds: number) => void;
  canModerate?: boolean;
  onToggleStatus?: (commentId: string, status: CommentStatus) => void;
  onDelete?: (commentId: string) => void;
  onReply?: (root: CommentNode) => void;
  isRoot: boolean;
}) {
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          className="rounded bg-ink-accent/10 px-1.5 py-0.5 font-mono text-xs text-ink-accent-strong hover:bg-ink-accent/20"
          onClick={() => onSelectTimecode(node.timestampSeconds)}
          title="Перейти до цього місця відео"
        >
          {formatTimecode(node.timestampSeconds)}
        </button>
        <span className="font-medium">{node.authorName}</span>
        {roleBadge(node.authorRole)}
        {isRoot && statusChip(node.status)}
        <span className="text-xs text-ink-muted">{formatDate(node.createdAt)}</span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-ink-text/95">{node.body}</p>
      <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
        {isRoot && onReply && (
          <button type="button" className="text-ink-muted hover:text-ink-text" onClick={() => onReply(node)}>
            Відповісти
          </button>
        )}
        {canModerate && isRoot && onToggleStatus && (
          <button
            type="button"
            className="text-ink-muted hover:text-ink-text"
            onClick={() => onToggleStatus(node.id, node.status === 'open' ? 'resolved' : 'open')}
          >
            {node.status === 'open' ? 'Виконано' : 'Відкрити знову'}
          </button>
        )}
        {canModerate && onDelete && (
          <button type="button" className="text-ink-danger/70 hover:text-ink-danger" onClick={() => onDelete(node.id)}>
            Видалити
          </button>
        )}
      </div>
    </div>
  );
}
