/**
 * Утиеми та парсинг таймкодів.
 * Внутрішнє представлення — секунди (number, дробові можливі).
 * UI: MM:SS до години, HH:MM:SS після години.
 */

/** «00:01:24» / «01:24» / «01:24.5» → 84 (секунди); некоректний ввід → null. */
export function parseTimecode(value: string): number | null {
  const raw = value.trim();
  if (!raw || raw.includes('-')) return null;
  const v = raw.replace(',', '.').replace(/[^\d:.]/g, '');
  if (!v) return null;
  const parts = v.split('.');
  const timePart = parts[0] ?? '';
  const frac = parts[1] ? `.${parts[1]}` : '';
  const seg = timePart.split(':').map((s) => s.trim());
  if (seg.length > 3 || seg.some((s) => s === '')) return null;
  for (const s of seg) {
    if (!/^\d+$/.test(s)) return null;
  }
  let seconds: number;
  if (seg.length === 1) seconds = Number(seg[0] + frac);
  else if (seg.length === 2) seconds = Number(seg[0]) * 60 + Number(seg[1] + frac);
  else seconds = Number(seg[0]) * 3600 + Number(seg[1]) * 60 + Number(seg[2] + frac);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds;
}

/** Секунди → «MM:SS» / «HH:MM:SS». Від'ємні значення — 00:00. */
export function formatTimecode(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const total = Math.floor(s);
  const sec = total % 60;
  const min = Math.floor(total / 60) % 60;
  const hh = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return hh > 0 ? `${pad(hh)}:${pad(min)}:${pad(sec)}` : `${pad(min)}:${pad(sec)}`;
}

/** Секунди → плавний текст «00:01:24» (для коментарів завжди з годинами при потребі). */
export function formatTimecodeLong(seconds: number): string {
  return formatTimecode(seconds);
}

/** Нормалізована позиція маркера на прогрес-барі: 0..1 (за замовчуванням точка — центр). */
export function markerRatio(timestampSeconds: number, durationSeconds: number | null | undefined): number {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  const r = timestampSeconds / durationSeconds;
  return Math.min(1, Math.max(0, r));
}

/** Обмеження часу до тривалості + допущення 0.5с (для підстраховки округлень). */
export function clampToDuration(seconds: number, durationSeconds: number | null | undefined, tolerance = 0.5): number {
  const s = Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
  if (!durationSeconds || durationSeconds <= 0) return s;
  return Math.min(s, Math.max(0, durationSeconds) + tolerance);
}
