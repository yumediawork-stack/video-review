import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminApi, resetMockData } from '../db';
import { isMockMode } from '../lib/config';
import { useAuth } from '../auth/AuthContext';
import ProjectCard from '../components/ProjectCard';
import ConfirmModal from '../components/ConfirmModal';
import type { ProjectBadgeState, ProjectSummary } from '../lib/types';

function badgeState(p: ProjectSummary): ProjectBadgeState {
  if (p.archivedAt) return 'archived';
  if (p.publishedVersionNumber) return 'published';
  if (p.hasReadyDraft) return 'draft';
  return 'no_video';
}

export default function AdminDashboardPage() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    adminApi
      .listProjects()
      .then((rows) => alive && setProjects(rows))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Не вдалося завантажити проєкти.'));
    return () => {
      alive = false;
    };
  }, []);

  async function createProject() {
    const t = newTitle.trim();
    if (!t) return;
    setBusy(true);
    try {
      const { id } = await adminApi.createProject(t, newDesc.trim() || null);
      setCreating(false);
      setNewTitle('');
      setNewDesc('');
      navigate(`/admin/projects/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося створити проєкт.');
    } finally {
      setBusy(false);
    }
  }

  const active = (projects ?? []).filter((p) => !p.archivedAt);
  const archived = (projects ?? []).filter((p) => !!p.archivedAt);

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-4 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Мої відео</h1>
          {isMockMode() && (
            <button
              type="button"
              className="mt-1 text-xs text-ink-warn underline hover:no-underline"
              onClick={() => {
                resetMockData();
                window.location.reload();
              }}
              title="Скинути демо-дані mock-режиму"
            >
              MOCK-режим — скинути демо-дані
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button type="button" className="vr-btn vr-btn-accent" onClick={() => setCreating(true)}>
            Новий проєкт
          </button>
          <button
            type="button"
            className="vr-btn"
            onClick={async () => {
              await signOut();
              navigate('/login', { replace: true });
            }}
          >
            Вийти
          </button>
        </div>
      </header>

      {error && (
        <p className="mt-4 rounded-card border border-[#7F2D2D] bg-[#3A222A] px-3 py-2 text-sm text-[#FFB4B4]" role="alert">
          {error}
        </p>
      )}

      {projects === null ? (
        <div className="mt-8 grid place-items-center text-ink-muted">
          <span className="vr-spinner h-6 w-6 rounded-full border-2 border-ink-accent border-t-transparent" aria-label="Завантаження" />
        </div>
      ) : (
        <>
          {active.length === 0 ? (
            <div className="mt-10 vr-card grid place-items-center gap-3 p-10 text-center">
              <p className="text-sm text-ink-muted">Ще немає жодного проєкту. Створіть перший і завантажте MP4-версію.</p>
              <button type="button" className="vr-btn vr-btn-accent" onClick={() => setCreating(true)}>
                Створити проєкт
              </button>
            </div>
          ) : (
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((p) => (
                <ProjectCard
                  key={p.id}
                  state={badgeState(p)}
                  title={p.title}
                  updatedAt={p.updatedAt}
                  publishedVersionNumber={p.publishedVersionNumber}
                  openComments={p.openComments}
                  hasReadyDraft={p.hasReadyDraft}
                  onOpen={() => navigate(`/admin/projects/${p.id}`)}
                />
              ))}
            </div>
          )}

          {archived.length > 0 && (
            <section className="mt-8">
              <button type="button" className="text-xs text-ink-muted hover:text-ink-text" onClick={() => setShowArchived((s) => !s)}>
                {showArchived ? '▾' : '▸'} Архів ({archived.length})
              </button>
              {showArchived && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {archived.map((p) => (
                    <ProjectCard
                      key={p.id}
                      state="archived"
                      title={p.title}
                      updatedAt={p.updatedAt}
                      publishedVersionNumber={p.publishedVersionNumber}
                      openComments={p.openComments}
                      hasReadyDraft={p.hasReadyDraft}
                      onOpen={() => navigate(`/admin/projects/${p.id}`)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}

      <ConfirmModal
        open={creating}
        title="Новий проєкт"
        confirmLabel="Створити"
        busy={busy}
        onCancel={() => setCreating(false)}
        onConfirm={createProject}
      >
        <label className="block text-left">
          <span className="vr-label">Назва</span>
          <input className="vr-input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Напр., Реклама кави" autoFocus />
        </label>
        <label className="mt-3 block text-left">
          <span className="vr-label">Опис (необов’язково)</span>
          <textarea className="vr-input min-h-[64px]" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
        </label>
      </ConfirmModal>

      <footer className="mt-10 text-center text-[11px] text-ink-muted/60">
        <Link to="/" className="hover:text-ink-muted">
          Video Review
        </Link>{' '}
        — персональний MVP
      </footer>
    </main>
  );
}
