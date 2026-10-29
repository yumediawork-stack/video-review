import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, isMockMode } from './config';

/**
 * Єдиний клієнт Supabase для фронтенду (адмін-дії під RLS).
 * Publishable key тут — це публічне значення: безпека забезпечується
 * RLS-політиками та серверними функціями, а НЕ секретністю ключа.
 * Ключ service_role ніколи не потрапляє у фронтенд.
 */
let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (isMockMode()) {
    throw new Error('Supabase не налаштований (mock-режим).');
  }
  if (!cached) {
    cached = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return cached;
}
