import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminApi, isMock } from '../db';
import { useAuth } from '../auth/AuthContext';
import ConfirmModal from '../components/ConfirmModal';
import CommentList from '../components/CommentList';
import CommentComposer from '../components/CommentComposer';
import VersionSelector from '../components/VersionSelector';
import UploadVideo from '../components/UploadVideo';
import AgentStreamCard from '../components/AgentStreamCard';
import VideoPlayer, { type VideoPlayerHandle } from '../components/VideoPlayer';
import { buildCommentTree, countOpenComments, sortRootComments } from '../lib/comments';
import { buildReviewUrl } from '../lib/config';
import type { CommentNode, FlatComment, ReviewLinkState, VersionInfo } from '../lib/types';

type CommentFilter = 'all' | 'open' | 'resolved';
const LINK_TOKEN_KEY = (projectId: string) => `vr_link_token_${projectId}`;

export default function AdminProjectPage() {
  const { projectId = '' } = useParams();
  const { isMock } = useAuth();

  const [meta, setMeta] = useState<{ title: string; description: string | null; archivedAt: string | null } | null>(null);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [comments, setComments] = useState<FlatComment[]>([]);
  const [link, setLink] = useState<ReviewLinkState>({ active: false, updatedAt: null });
  const [copiedToken, setCopiedToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(LINK_TOKEN_KEY(projectId));
    } catch {
      return null;
    }
  });

  const [pageError, setPageError] = useState<string | null>(null);
  const [filter, setFilter] = useState<CommentFilter>('all');
  const [sortBy, setSortBy] = useState<'timecode' | 'date'>('timecode');
  const [busy, setBusy] = useState(false);

  // модалки
  const [publishTarget, setPublishTarget] = useState<VersionInfo | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CommentNode | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [descOpen, setDescOpen] = useState(false);
  const [descValue, setDescValue] = useState('');

  // коментарі
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyRoot, setReplyRoot] = useState<CommentNode | null>(null);
  const [composerBusy, setComposerBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);

  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const fetchSeq = useRef(0);
  const commentSeq = useRef(0);

  const selected = versions.find((v) => v.id === selectedVersionId) ?? null;
  const selectedIsReady = selected?.status === 'ready'; // не published
  const selectedMedia = selected?.mediaUrl ?? null;

  const roots = useMemo(() => {
    const tree = buildCommentTree(comments);
    const filtered = tree.filter((r) => (filter === 'all' ? true : r.status === filter));
    return sortRootComments(filtered, sortBy);
  }, [comments, filter, sortBy]);

  const openCount = useMemo(() => countOpenComments(buildCommentTree(comments)), [comments]);

  const markers = useMemo(
    () =>
      buildCommentTree(comments).map((r) => ({
        id: r.id,
        seconds: r.timestampSeconds,
        label: `${r.authorName}: ${r.body.slice(0, 60)}`,
      })),
    [comments],
  );

  const reloadAll = useCallback(
    async (keepSelected?: string) => {
      const seq = ++fetchSeq.current;
      try {
        const [m, vs, lk] = await Promise.all([adminApi.getProjectMeta(projectId), adminApi.listVersions(projectId), adminApi.getReviewLink(projectId)]);
        if (seq !== fetchSeq.current) return;
        setMeta(m);
        setVersions(vs);
        setLink(lk);
        const target =
          (keepSelected && vs.find((v) => v.id === keepSelected)?.id) ||
          selectedVersionId ||
          vs.find((v) => v.status === 'published')?.id ||
          vs.find((v) => v.status === 'ready')?.id ||
          vs[vs.length - 1]?.id ||
          null;
        setSelectedVersionId(target);
      } catch (e) {
        if (seq === fetchSeq.current) setPageError(e instanceof Error ? e.message : 'Помилка завантаження.');
      }
    },
    [projectId, selectedVersionId],
  );

  useEffect(() => {
    void reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // коментарі/медіа вибраної версії
  useEffect(() => {
    let alive = true;
    const seq = ++commentSeq.current;
    setComments([]);
    if (!selectedVersionId) return;
    adminApi
      .listAdminComments(projectId, selectedVersionId)
      .then((flat) => {
        if (alive && seq === commentSeq.current) setComments(flat);
      })
      .catch((e) => alive && setPageError(e instanceof Error ? e.message : 'Не вдалося завантажити коментарі.'));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersionId]);

  useEffect(() => {
    if (selectedVersionId && selected && !selected.mediaUrl && (selected.status === 'published' || selected.status === 'ready')) {
      adminApi
        .getVideoUrl(projectId, selectedVersionId)
        .then((url) =>
          setVersions((old) => old.map((v) => (v.id === selectedVersionId ? { ...v, mediaUrl: url } : v))),
        )
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersionId, selected?.status]);

  function seekTo(seconds: number) {
    playerRef.current?.seekTo(seconds, false);
  }

  async function doPublish(target: VersionInfo) {
    setBusy(true);
    try {
      await adminApi.publishVersion(projectId, target.id);
      await Promise.all([
        adminApi.listVersions(projectId).then((vs) => {
          setVersions(vs);
        }),
        adminApi.getReviewLink(projectId).then((lk) => setLink(lk)),
      ]);
      setPublishTarget(null);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Публікація не вдалася.');
      setPublishTarget(null);
    } finally {
      setBusy(false);
    }
  }

  async function createLink() {
    setBusy(true);
    try {
      const token = await adminApi.createOrRotateReviewLink(projectId);
      try {
        sessionStorage.setItem(LINK_TOKEN_KEY(projectId), token);
      } catch { /* ignore */ }
      setCopiedToken(token);
      const lk = await adminApi.getReviewLink(projectId);
      setLink(lk);
      setPageError(null);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Не вдалося створити посилання.');
    } finally {
      setBusy(false);
    }
  }

  async function revokeLink() {
    setBusy(true);
    try {
      await adminApi.revokeReviewLinks(projectId);
      try {
        sessionStorage.removeItem(LINK_TOKEN_KEY(projectId));
      } catch { /* ignore */ }
      setCopiedToken(null);
      setLink({ active: false, updatedAt: null });
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Не вдалося відкликати посилання.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(commentId: string, status: 'open' | 'resolved') {
    try {
      await adminApi.setCommentStatus(commentId, status);
      setComments((old) => old.map((c) => (c.id === commentId ? { ...c, status } : c)));
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Не вдалося оновити статус.');
    }
  }

  async function removeComment(node: CommentNode) {
    setBusy(true);
    try {
      await adminApi.deleteComment(node.id);
      // м'яке видалення: ховаємо корінь з усією гілкою або лише відповідь
      setComments((old) =>
        node.parentId
          ? old.filter((c) => c.id !== node.id)
          : old.filter((c) => c.id !== node.id && c.parentId !== node.id),
      );
      setDeleteTarget(null);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Не вдалося видалити коментар.');
    } finally {
      setBusy(false);
    }
  }

  async function addComment(payload: { authorName: string; text: string; timestampSeconds: number }) {
    if (!selectedVersionId) return;
    setComposerBusy(true);
    setComposerError(null);
    try {
      const created = await adminApi.addAdminComment(projectId, selectedVersionId, {
        authorName: payload.authorName,
        body: payload.text,
        timestampSeconds: payload.timestampSeconds,
        parentId: replyRoot?.id ?? null,
      });
      setComments((old) => [...old, created]);
      setComposerOpen(false);
      setReplyRoot(null);
    } catch (e) {
      setComposerError(e instanceof Error ? e.message : 'Не вдалося зберегти коментар.');
    } finally {
      setComposerBusy(false);
    }
  }

  async function rename() {
    const t = renameValue.trim();
    if (!t) return;
    setBusy(true);
    try {
      await adminApi.renameProject(projectId, t);
      await reloadAll();
      setRenameOpen(false);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Не вдалося перейменувати.');
    } finally {
      setBusy(false);
    }
  }

  async function saveDescription() {
    setBusy(true);
    try {
      await adminApi.setProjectDescription(projectId, descValue.trim() || null);
      await reloadAll();
      setDescOpen(false);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Не вдалося зберегти опис.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!meta) return;
    setBusy(true);
    try {
      await adminApi.setProjectArchived(projectId, !meta.archivedAt);
      await reloadAll();
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Не вдалося змінити стан.');
    } finally {
      setBusy(false);
    }
  }

  if (!meta && !pageError) {
    return (
      <main className="grid min-h-screen place-items-center p-4">
        <span className="vr-spinner h-6 w-6 rounded-full border-2 border-ink-accent border-t-transparent" aria-label="Завантаження" />
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-6">
      {/* Breadcrumbs + заголовок */}
      <nav className="flex flex-wrap items-center gap-2 text-xs text-ink-muted" aria-label="Навігація">
        <Link to="/admin" className="hover:text-ink-text">
          Мої відео
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-ink-text">{meta?.title ?? 'Проєкт'}</span>
      </nav>

      <header className="mt-2 flex flex-wrap items-start justify-between gap-3">        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">
            {meta?.title}
            {meta?.archivedAt && <span className="vr-chip bg-white/10 text-ink-muted">Архів</span>}
            {isMock && <span className="vr-chip bg-[#33261A] text-ink-warn">MOCK</span>}
          </h1>
          {meta?.description && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{meta.description}</p>}
          <div className="mt-1.5 flex gap-3 text-xs">
            <button type="button" className="text-ink-muted hover:text-ink-text" onClick={() => { setRenameValue(meta?.title ?? ''); setRenameOpen(true); }}>
              Перейменувати
            </button>
            <button type="button" className="text-ink-muted hover:text-ink-text" onClick={() => { setDescValue(meta?.description ?? ''); setDescOpen(true); }}>
              Опис
            </button>
            <button type="button" className="text-ink-muted hover:text-ink-text" onClick={toggleArchive} disabled={busy}>
              {meta?.archivedAt ? 'Розархівувати' : 'До архіву'}
            </button>
          </div>
        </div>
        <Link to="/admin" className="vr-btn">
          ← До списку
        </Link>
      </header>

      {pageError && (
        <p className="mt-4 rounded-card border border-[#7F2D2D] bg-[#3A222A] px-3 py-2 text-sm text-[#FFB4B4]" role="alert">
          {pageError}
        </p>
      )}

      {/*
        ВАЖЛИВО: публікація доступна лише для ready-чернетки; активна версія
        змінюється атомарно (RPC publish_version). Нова версія не «публікується»
        автоматично після завантаження.
      */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        {/* Ліва колонка */}
        <section className="flex min-w-0 flex-col gap-4">
          <VersionSelector versions={versions} selectedId={selectedVersionId} onSelect={setSelectedVersionId} />

          <VideoPlayer
            ref={playerRef}
            src={selectedMedia}
            markers={markers}
            pauseOnSeek
            onSourceError={async () => (selectedVersionId ? adminApi.getVideoUrl(projectId, selectedVersionId) : null)}
          />

          {/* Гостьове посилання */}
          <section className="vr-card p-4" aria-label="Гістьове посилання">
            <h3 className="text-sm font-semibold">Посилання для глядача</h3>
            {copiedToken ? (
              <div className="mt-2 flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input readOnly className="vr-input flex-1 font-mono text-xs" value={buildReviewUrl(copiedToken)} onFocus={(e) => e.currentTarget.select()} aria-label="Review посилання" />
                  <button
                    type="button"
                    className="vr-btn vr-btn-accent"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(buildReviewUrl(copiedToken));
                      } catch {
                        document.execCommand?.('copy');
                      }
                    }}
                  >
                    Скопіювати посилання
                  </button>
                </div>
                <p className="text-[11px] leading-relaxed text-ink-warn">
                  Токен показується лише один раз. Після перезавантаження сторінки скопіювати те саме посилання неможливо — тоді створіть нове
                  (старе перестане працювати) або збережіть це у менеджері паролів.
                </p>
              </div>
            ) : link.active ? (
              <p className="mt-2 text-xs text-ink-muted">
                Активне посилання існує, але токен не можна показати вдруге (зберігається лише хеш). Поруч немає посилання у буфері — створіть
                нове посилання, щоб скопіювати.
              </p>
            ) : (
              <p className="mt-2 text-xs text-ink-muted">Посилання ще не створене.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="vr-btn" onClick={createLink} disabled={busy}>
                {copiedToken ? 'Створити нове посилання (ротація)' : 'Створити посилання'}
              </button>
              {link.active && (
                <button type="button" className="vr-btn vr-btn-danger" onClick={revokeLink} disabled={busy}>
                  Відкликати посилання
                </button>
              )}
            </div>
          </section>

          <UploadVideo projectId={projectId} createVersionDraft={adminApi.createVersionDraft.bind(adminApi)} onCompleted={() => void reloadAll(selectedVersionId ?? undefined)} />

          <AgentStreamCard projectId={projectId} versions={versions} />

          {/* Публікація */}
          {selected && (
            <section className="vr-card p-4" aria-label="Публікація">
              <h3 className="text-sm font-semibold">Публікація</h3>
              {selected.isPublished ? (
                <p className="mt-1 text-xs text-ink-success">Ця версія активна для глядачів.</p>
              ) : selectedIsReady ? (
                <>
                  <p className="mt-1 text-xs text-ink-muted">
                    Версія v{selected.versionNumber} готова. Опублікувати — глядач побачить її за постійним посиланням.
                  </p>
                  <button type="button" className="vr-btn vr-btn-accent mt-3" onClick={() => setPublishTarget(selected)}>
                    Опублікувати цю версію
                  </button>
                </>
              ) : (
                <p className="mt-1 text-xs text-ink-muted">Версія не готова до публікації (upload не завершений або файл має статус помилки).</p>
              )}
            </section>
          )}
        </section>

        {/* Права колонка: коментарі */}
        <aside className="flex min-w-0 flex-col gap-3" aria-label="Коментарі версії">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Коментарі <span className="text-ink-muted">({openCount} відкритих)</span>
            </h2>
            <button type="button" className="vr-btn px-2 py-1 text-xs" onClick={() => selectedVersionId && void reloadAll(selectedVersionId)}>
              Оновити
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex overflow-hidden rounded-lg border border-ink-line" role="group" aria-label="Фільтр статусу">
              {(
                [
                  ['all', 'Всі'],
                  ['open', 'Відкриті'],
                  ['resolved', 'Виконані'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`px-2.5 py-1.5 transition-colors ${filter === key ? 'bg-ink-accent/20 text-ink-text' : 'hover:bg-ink-raised text-ink-muted'}`}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-1">
              <span className="text-ink-muted">Сортування</span>
              <select className="rounded-lg border border-ink-line bg-ink-raised px-1.5 py-1" value={sortBy} onChange={(e) => setSortBy(e.target.value as 'timecode' | 'date')}>
                <option value="timecode">таймкод</option>
                <option value="date">дата</option>
              </select>
            </label>
          </div>

          {composerOpen ? (
            <CommentComposer
              getCurrentTime={() => playerRef.current?.getCurrentTime() ?? 0}
              defaultAuthor={typeof localStorage !== 'undefined' ? localStorage.getItem('vr_author_name') ?? 'Монтажер' : 'Монтажер'}
              submitLabel={replyRoot ? 'Відповісти' : 'Надіслати'}
              busy={composerBusy}
              error={composerError}
              lockedTime={replyRoot ? replyRoot.timestampSeconds : null}
              onCancel={() => {
                setComposerOpen(false);
                setReplyRoot(null);
                setComposerError(null);
              }}
              onSubmit={addComment}
            />
          ) : (
            <button type="button" className="vr-btn vr-btn-accent" onClick={() => setComposerOpen(true)} disabled={!selectedVersionId}>
              Залишити коментар на {formatTime(playerRef.current?.getCurrentTime() ?? 0)}
            </button>
          )}

          <div className="scroll-panel max-h-[70vh] overflow-y-auto pr-1">
            <CommentList
              roots={roots}
              onSelectTimecode={seekTo}
              canModerate
              onToggleStatus={toggleStatus}
              onDelete={(id) => {
                const target = buildCommentTree(comments).find((r) => r.id === id);
                if (target) setDeleteTarget(target);
              }}
              onReply={(root) => {
                setReplyRoot(root);
                setComposerOpen(true);
              }}
              activeReplyRootId={replyRoot?.id ?? null}
              replySlot={(root) => (
                <div className="text-right text-xs">
                  <button
                    type="button"
                    className="text-ink-muted hover:text-ink-text"
                    onClick={() => {
                      setReplyRoot(null);
                      seekTo(root.timestampSeconds);
                    }}
                  >
                    Скасувати форму відповіді
                  </button>
                </div>
              )}
            />
          </div>
        </aside>
      </div>

      {/* Модалки */}
      <ConfirmModal open={!!publishTarget} title={`Опублікувати v${publishTarget?.versionNumber ?? ''}?`} confirmLabel="Опублікувати" busy={busy} onCancel={() => setPublishTarget(null)} onConfirm={() => publishTarget && void doPublish(publishTarget)}>
        Глядач за постійним посиланням побачить цю версію одразу. Попередня опублікована версія залишиться доступною вам в історії.
      </ConfirmModal>

      <ConfirmModal
        open={!!deleteTarget}
        title="Видалити коментар?"
        confirmLabel="Видалити"
        danger
        busy={busy}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void removeComment(deleteTarget)}
      >
        {deleteTarget?.parentId ? 'Видалити цю відповідь?' : 'Коментар і його відповіді зникнуть зі списку (м\'яке видалення в базі).'}
      </ConfirmModal>

      <ConfirmModal open={renameOpen} title="Нова назва проєкту" confirmLabel="Зберегти" busy={busy} onCancel={() => setRenameOpen(false)} onConfirm={rename}>
        <input className="vr-input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={120} autoFocus />
      </ConfirmModal>

      <ConfirmModal open={descOpen} title="Опис проєкту" confirmLabel="Зберегти" busy={busy} onCancel={() => setDescOpen(false)} onConfirm={saveDescription}>
        <textarea className="vr-input min-h-[80px]" value={descValue} onChange={(e) => setDescValue(e.target.value)} />
      </ConfirmModal>
    </main>
  );
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const s = String(total % 60).padStart(2, '0');
  const m = String(Math.floor(total / 60) % 60).padStart(2, '0');
  const h = Math.floor(total / 3600);
  return h > 0 ? `${String(h).padStart(2, '0')}:${m}:${s}` : `${m}:${s}`;
}
