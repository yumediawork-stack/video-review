/**
 * Допоміжні функції для live-трансляції з компьютера редактора (агент-режим).
 */

/** URL версії у потокі агента: <базовий тунель>/v/<versionId>.mp4 */
export function buildAgentStreamUrl(agentBaseUrl: string, versionId: string): string {
  const base = agentBaseUrl.replace(/\/+$/, '');
  return `${base}/v/${versionId}.mp4`;
}

export const AGENT_ONLINE_WINDOW_MS = 120_000;

/** Онлайн, якщо минуло ≤ 2 хв від останнього announce (серверний heartbeat 60 с). */
export function isAgentOnline(agentBeat: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (!agentBeat) return false;
  const t = new Date(agentBeat).getTime();
  if (!Number.isFinite(t)) return false;
  return nowMs - t < AGENT_ONLINE_WINDOW_MS;
}
