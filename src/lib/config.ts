/** Читання Vite-змінних оточення та визначення режиму. */

const env = import.meta.env;

export const SUPABASE_URL: string = (env.VITE_SUPABASE_URL as string | undefined) ?? '';
export const SUPABASE_PUBLISHABLE_KEY: string = (env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ?? '';
export const BASE_PATH: string = (env.VITE_BASE_PATH as string | undefined) || '/video-review/';

/**
 * Mock-режим — демо-дані локально (без Supabase).
 * Увімкнено автоматично, якщо не задано VITE_SUPABASE_URL,
 * або примусово через VITE_USE_MOCK=1.
 */
export function isMockMode(): boolean {
  if (env.VITE_USE_MOCK === '1') return true;
  if (env.VITE_USE_MOCK === '0') return false;
  return !SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT');
}

/** Повний URL review-сторінки для копіювання (тільки hash-частина змінюється). */
export function buildReviewUrl(token: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${BASE_PATH}#/review/${token}`;
}

export const POLL_INTERVAL_MS = 25_000;
export const SIGNED_URL_TTL_SECONDS = 7200; // має збігатися з Edge Functions
