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
const GITHUB_RAW = 'https://raw.githubusercontent.com/yumediawork-stack/video-review/main/agent';

export default function AgentStreamCard({ projectId, versions }: { projectId: string; versions: VersionInfo[] }) {
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [showRevoke, setShowRevoke] = useState(false);

  // Команди підключення показуються одразу після активації (токен вписано).
  const cmdWindows = freshToken
    ? `& ([scriptblock]::Create((irm '${GITHUB_RAW}/agent-boot.ps1'))) '${SUPABASE_URL}' '${freshToken}' -Watch 'D:\\DaVinci Exports'`
    : '';
  const cmdMac = freshToken
    ? `curl -fsSL '${GITHUB_RAW}/agent-boot.sh' | bash -s -- '${SUPABASE_URL}' '${freshToken}' '~/Movies/DaVinci Exports'`
    : '';

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
                <span className="text-xs text-ink-warn">Ключ уже вписано в команди нижче — копіюйте зараз.</span>
              )}
            </div>
          )}

          {freshToken && (
            <div className="mt-3 flex flex-col gap-3">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="vr-label mb-0">Windows (PowerShell)</span>
                  <button
                    type="button"
                    className="vr-btn px-2 py-1 text-xs"
                    onClick={async () => {
                      try { await navigator.clipboard.writeText(cmdWindows); } catch { /* ignore */ }
                    }}
                  >
                    Скопіювати команду
                  </button>
                </div>
                <pre className="mt-1 overflow-x-auto rounded bg-[#0F1218] p-2 text-[11px] leading-relaxed text-ink-accent-strong">{cmdWindows}</pre>
              </div>

              <details>
                <summary className="cursor-pointer text-xs text-ink-muted hover:text-ink-text">macOS / Linux (bash)</summary>
                <div className="mt-1">
                  <pre className="overflow-x-auto rounded bg-[#0F1218] p-2 text-[11px] leading-relaxed text-ink-accent-strong">{cmdMac}</pre>
                </div>
              </details>

              <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs text-ink-muted">
                <li>На ПК з DaVinci вставте команду → Enter (щоразу т ж. сама на перший раз).</li>
                <li>Агент сам скачає стабільну версію, підніме тунель підключиться до+self-прийде онлайн в адмінку.</li>
                <li>Створеться ярлик «Video Review Agent» на робочому столі — наступні запуски одним Tclikом двойного.</li>
                <li>Розмістіть те MP4 у вказану папку → агент створить чернетку → «Опублікувати цю версію».</li>
              </ol>
              <p className="text-[11px] text-ink-muted">
                Потрібен <span className="text-ink-text">Node.js 20+</span> на цьому ПК: https://nodejs.org
              </p>
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
