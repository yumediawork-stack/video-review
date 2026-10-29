import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import CommentList from '../components/CommentList';
import CommentComposer from '../components/CommentComposer';
import VideoPlayer, { type VideoPlayerHandle } from '../components/VideoPlayer';
import { reviewApi } from '../review';
import { buildCommentTree, sortRootComments } from '../lib/comments';
import { POLL_INTERVAL_MS } from '../lib/config';
import { ApiError, type ApiErrorCode, type FlatComment, type ReviewAccess } from '../lib/types';

type Screen =
  | { kind: 'loading' }
  | { kind: 'error'; code: ApiErrorCode; message: string }
  | { kind: 'empty' } // немає опублікованої версії
  | { kind: 'ready' };

/**
 * Гостьова review-сторінка: без логіну, працює лише з одним постійним посиланням.
 * Нову версію детектуємо через polling (revision); відео НЕ перемикаємо
 * автоматично — показуємо банер + кнопку «Оновити відео».
 */
export default function ReviewPage() {
  const { token = '' } = useParams();
  const [screen, setScreen] = useState<Screen>({ kind: 'loading' });
  const [data, setData] = useState<ReviewAccess | null>(null);
  const [comments, setComments] = useState<FlatComment[]>([]);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [newerRevision, setNewerRevision] = useState<string | null>(null);
  const [updatedLabel, setUpdatedLabel] = useState('');

  const [composerOpen, setComposerOpen] = useState(false);
  const [replyRoot, setReplyRoot] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [versionChanged, setVersionChanged] = useState(false);
  const [streamOffline, setStreamOffline] = useState(false);

  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const revisionRef = useRef('');
  const fetchIdRef = useRef(0);

  const load = useCallback(async (tokenValue: string) => {
    const id = ++fetchIdRef.current;
    try {
      const access = await reviewApi.read(tokenValue);
      if (id !== fetchIdRef.current) return;
      setData(access);
      setComments(access.comments);
      setVideoSrc(access.video.offline ? null : access.video.url);
      setStreamOffline(access.video.offline === true);
      revisionRef.current = access.revision;
      setScreen({ kind: 'ready' });
      setVersionChanged(false);
    } catch (e) {
      if (id !== fetchIdRef.current) return;
      if (e instanceof ApiError) {
        setScreen(e.code === 'no_published_version' ? { kind: 'empty' } : { kind: 'error', code: e.code, message: e.message });
      } else {
        setScreen({ kind: 'error', code: 'internal_error', message: 'Помилка завантаження. Спробуйте оновити сторінку.' });
      }
    }
  }, []);

  useEffect(() => {
    if (!token) {
      setScreen({ kind: 'error', code: 'invalid_or_revoked_link', message: 'Некоректне посилання.' });
      return;
    }
    setScreen({ kind: 'loading' });
    void load(token);
    // Polling кожні 25 с + банер нової версії; не рванути відео автоматично.
    const interval = window.setInterval(() => {
      void (async () => {
        try {
          const access = await reviewApi.read(token);
          if (!revisionRef.current) return;
          if (access.revision !== revisionRef.current) {
            setNewerRevision(access.revision);
          }
          setStreamOffline(access.video.offline === true);
          if (access.video.offline) setVideoSrc(null);
        } catch {
          /* перегляд не рвемо; окремо спрацює помилка самого плеєра */
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [token, load]);

  useEffect(() => {
    if (data) {
      setUpdatedLabel(new Intl.DateTimeFormat('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date()));
    }
  }, [data?.revision]);

  const roots = useMemo(() => sortRootComments(buildCommentTree(comments), 'timecode'), [comments]);

  async function switchToNewVersion() {
    setNewerRevision(null);
    setScreen({ kind: 'loading' });
    await load(token);
    setReplyRoot(null);
  }

  async function submitComment(payload: { authorName: string; text: string; timestampSeconds: number }) {
    if (!data) return;
    setBusy(true);
    setComposerError(null);
    try {
      const created = await reviewApi.comment(token, {
        versionId: data.version.id,
        authorName: payload.authorName,
        text: payload.text,
        timestampSeconds: payload.timestampSeconds,
        parentId: replyRoot ?? null,
      });
      // одразу показуємо новий коментар без подвійного відображення
      setComments((old) => (old.some((c) => c.id === created.id) ? old : [...old, created]));
      setComposerOpen(false);
      setReplyRoot(null);
      setDraft('');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'version_changed') {
        setVersionChanged(true);
        setNewerRevision('changed');
        setComposerOpen(false);
      } else {
        // текст залишається у полі (controlled draft не скидаємо)
        setComposerError(e instanceof Error ? e.message : 'Не вдалося надіслати коментар.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (screen.kind === 'loading') {
    return (
      <main className="grid min-h-screen place-items-center p-4">
        <span className="vr-spinner h-6 w-6 rounded-full border-2 border-ink-accent border-t-transparent" aria-label="Завантаження" />
      </main>
    );
  }

  if (screen.kind === 'error') {
    // Жодних приватних даних — нейтральні екрани.
    const linkProblem =
      screen.code === 'invalid_or_revoked_link' || screen.code === 'not_found' || screen.code === 'invalid_input';
    return (
      <main className="grid min-h-screen place-items-center p-4">
        <div className="vr-card max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold">{linkProblem ? 'Посилання більше не активне' : 'Щось пішло не так'}</h1>
          <p className="mt-2 text-sm text-ink-muted">{linkProblem ? 'Перевірте посилання або зверніться до автора.' : screen.message}</p>
        </div>
      </main>
    );
  }

  if (screen.kind === 'empty') {
    return (
      <main className="grid min-h-screen place-items-center p-4">
        <div className="vr-card max-w-md p-8 text-center">
          <h1 className="text-lg font-semibold">Відео ще не опубліковано</h1>
          <p className="mt-2 text-sm text-ink-muted">Власник ще не опублікував версію для перегляду. Завітайте пізніше.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-6">
      {data && (
        <>
          <header className="flex flex-wrap items-end justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold">{data.projectTitle}</h1>
              <p className="text-xs text-ink-muted">
                Версія v{data.version.number}
                {data.version.durationSeconds ? ` · ${Math.round(data.version.durationSeconds)} с` : ''}
                {updatedLabel ? ` · оновлено ${updatedLabel}` : ''}
              </p>
              {data.projectDescription && <p className="mt-1 max-w-2xl text-sm text-ink-muted">{data.projectDescription}</p>}
            </div>
          </header>

          {(newerRevision || versionChanged) && (
            <div
              className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-card border border-ink-accent/40 bg-ink-accent/10 px-4 py-3 text-sm"
              role="status"
            >
              <span>Доступна нова версія. Відео не перемкнеться автоматично.</span>
              <button
                type="button"
                className="vr-btn vr-btn-accent"
                onClick={() => {
                  setVersionChanged(false);
                  void switchToNewVersion();
                }}
              >
                {versionChanged ? 'Перейти до нової версії' : 'Оновити відео'}
              </button>
            </div>
          )}

          <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
            {streamOffline || data.video.offline ? (
              <section className="vr-card grid place-items-center gap-3 p-10 text-center" aria-label="Трансляція недоступна">
                <div className="text-3xl" aria-hidden="true">📡</div>
                <h2 className="text-base font-semibold">Монтажер зараз офлайн</h2>
                <p className="max-w-sm text-sm text-ink-muted">
                  Це live-трансляція з комп'ютера редактора — вона доступна, коли агент запущений
                  і файл відкритий. Коментарі залишаються доступними — пишіть, автор побачить.
                </p>
                <button
                  type="button"
                  className="vr-btn vr-btn-accent"
                  onClick={() => {
                    setStreamOffline(false);
                    void load(token);
                  }}
                >
                  Спробувати знову
                </button>
              </section>
            ) : (
              <VideoPlayer
                ref={playerRef}
                src={videoSrc}
                markers={roots.map((r) => ({ id: r.id, seconds: r.timestampSeconds, label: `${r.authorName}: ${r.body.slice(0, 60)}` }))}
                pauseOnSeek={false}
                onSourceError={async () => {
                  try {
                    if (!data) return null;
                    const res = await reviewApi.refreshVideoUrl(token, data.version.id);
                    setVideoSrc(res.url);
                    setStreamOffline(false);
                    return res.url;
                  } catch (e) {
                    if (e instanceof ApiError && e.code === 'stream_offline') {
                      setStreamOffline(true);
                      setVideoSrc(null);
                    }
                    return null;
                  }
                }}
              />
            )}

            <aside className="flex min-w-0 flex-col gap-3" aria-label="Коментарі">
              <h2 className="text-sm font-semibold">Коментарі</h2>

              {composerOpen ? (
                <CommentComposer
                  compact
                  getCurrentTime={() => playerRef.current?.getCurrentTime() ?? 0}
                  busy={busy}
                  error={composerError}
                  text={draft}
                  onTextChange={setDraft}
                  lockedTime={replyRoot ? roots.find((r) => r.id === replyRoot)?.timestampSeconds ?? null : null}
                  onCancel={() => {
                    setComposerOpen(false);
                    setReplyRoot(null);
                    setComposerError(null);
                  }}
                  onSubmit={submitComment}
                />
              ) : (
                <button type="button" className="vr-btn vr-btn-accent" onClick={() => setComposerOpen(true)}>
                  Залишити коментар
                </button>
              )}

              <div className="scroll-panel max-h-[65vh] overflow-y-auto pr-1">
                <CommentList
                  roots={roots}
                  onSelectTimecode={(s) => playerRef.current?.seekTo(s)}
                  canModerate={false}
                  onReply={(root) => {
                    setReplyRoot(root.id);
                    setComposerOpen(true);
                    setComposerError(null);
                  }}
                  activeReplyRootId={replyRoot}
                  replySlot={() => (
                    <div className="text-right text-xs">
                      <button type="button" className="text-ink-muted hover:text-ink-text" onClick={() => setReplyRoot(null)}>
                        Скасувати відповідь
                      </button>
                    </div>
                  )}
                />
              </div>
            </aside>
          </div>

          <footer className="mt-8 text-center text-[11px] text-ink-muted/50">Персональне посилання. Не передавайте його далі без потреби.</footer>
        </>
      )}
    </main>
  );
}
