import { useEffect, useState } from 'react';
import { adminApi } from '../db';
import { SUPABASE_URL } from '../lib/config';
import { isMockMode } from '../lib/config';
import { isAgentOnline } from '../lib/stream';
import type { VersionInfo } from '../lib/types';
import ConfirmModal from './ConfirmModal';

/**
 * «Трансляція з вашого PC»: агент-ключ (hash-only у БД, raw — один раз),
 * завантаження agent.json і команди для запуску локального агенту.
 * Відео НЕ завантажується у сховище — гість дивиться файл із вашого Mac.
 */
export default function AgentStreamCard({ projectId, versions }: { projectId: string; versions: VersionInfo[] }) {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [showRevoke, setShowRevoke] = useState(false);

  useEffect(() => {
    adminApi
      .getAgentState(projectId)
      .then((s) => setActive(s.active))
      .catch((e) => setError(e instanceof Error ? e.message : 'Помилка статусу агенту.'))
      .finally(() => setLoading(false));
  }, [projectId]);

  const agentVersions = versions.filter((v) => v.mediaSource === 'agent');
  const lastBeat = agentVersions.map((v) => v.agentBeat).filter(Boolean).sort((a, b) => String(b).localeCompare(String(a)))[0] ?? null;
  const online = isAgentOnline(lastBeat);

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const token = await adminApi.createAgentKey(projectId);
      setFreshToken(token);
      setActive(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося активувати агент.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await adminApi.revokeAgentKey(projectId);
      setActive(false);
      setFreshToken(null);
      setShowRevoke(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не вдалося відкликати агент-ключ.');
    } finally {
      setBusy(false);
    }
  }

  function downloadAgentConfig() {
    const config = JSON.stringify(
      { projectId, agentToken: freshToken ?? '', apiUrl: SUPABASE_URL, watchDir: '/ЗМІНІТЬ_НА/Шлях/До/DaVinci_Export' },
      null,
      2,
    );
    const blob = new Blob([config], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'agent.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="vr-card p-4" aria-label="Трансляція з вашого PC">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Трансляція з вашого PC (без завантаження)</h3>
          <p className="mt-1 text-xs text-ink-muted">
            Гість дивиться MP4 прямо з вашого комп'ютера через тунель — у сховище нічого не пішде.
            Ваш Mac має бути ввімкнений та онлайн.
          </p>
        </div>
        {lastBeat && (
          <span className={`vr-chip shrink-0 ${online ? 'bg-[#16301F] text-ink-success' : 'bg-white/10 text-ink-muted'}`}>
            {online ? 'Агент онлайн' : 'Агент офлайн'}
          </span>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs text-ink-danger" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-2 text-xs text-ink-muted">Перевіряю стан…</p>
      ) : isMockMode() ? (
        <p className="mt-2 text-xs text-ink-muted">Доступно лише у реальному режимі (з Supabase).</p>
      ) : (
        <>
          {!active && !freshToken && (
            <button type="button" className="vr-btn vr-btn-accent mt-3" onClick={activate} disabled={busy}>
              Активувати агент для цього проєкту
            </button>
          )}

          {active && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className="vr-btn" onClick={() => setShowRevoke(true)} disabled={busy}>
                Відкликати агент-ключ
              </button>
              {freshToken && (
                <span className="text-xs text-ink-warn">Ключ показано нижче — збережіть його зараз.</span>
              )}
            </div>
          )}

          {freshToken && (
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <code className="flex-1 rounded bg-[#0F1218] px-2 py-1.5 font-mono text-xs text-ink-accent-strong break-all">
                  {freshToken}
                </code>
                <button
                  type="button"
                  className="vr-btn"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(freshToken); } catch { /* ignore */ }
                  }}
                >
                  Скопіювати ключ
                </button>
                <button type="button" className="vr-btn vr-btn-accent" onClick={downloadAgentConfig}>
                  Завантажити agent.json
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-ink-warn">
                Токен показується лише один раз (в БД — лише хеш). Після перезавантаження
                сторінки для нового ключа натисніть «Активувати агент» знову (старе відкликатиметься).
              </p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs text-ink-muted">
                <li>Скачайте <code className="text-ink-text">agent.json</code> у теку <code className="text-ink-text">agent/</code> розділу.</li>
                <li>
                  Запуск: <code className="text-ink-text">node agent.mjs ./agent.json "/шлях/до/папки з MP4"</code>
                </li>
                <li>
                  Тунель: якщо немає <code className="text-ink-text">cloudflared</code> — агент сам його завантажить
                  (чи <code className="text-ink-text">brew install cloudflared</code>).
                </li>
                <li>Експортували новий файл у цю теку → агент створить чернетку, натисніть «Опублікувати цю версію».</li>
              </ol>
            </div>
          )}
        </>
      )}

      {agentVersions.length > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          Agent-версії: v{agentVersions[agentVersions.length - 1].versionNumber} (остання) ·
          {' '}{lastBeat ? new Date(lastBeat).toLocaleTimeString('uk-UA') : '—'} — останній сигнал.
        </p>
      )}

      <ConfirmModal
        open={showRevoke}
        title="Відкликати агент-ключ?"
        confirmLabel="Відкликати"
        danger
        busy={busy}
        onCancel={() => setShowRevoke(false)}
        onConfirm={revoke}
      >
        Працюючий агент втратить доступ (буде помилка announce). Гости побачать «Монтажер офлайн».
      </ConfirmModal>
    </section>
  );
}
