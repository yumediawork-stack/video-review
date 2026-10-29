/**
 * Клієнт БД: service_role ЖИВЕ ТІЛЬКИ в Edge Functions (не у фронтенді!).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Edge Function env не налаштовано: очікуються SUPABASE_URL і SUPABASE_SERVICE_ROLE_KEY');
}

export function serviceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface ReviewLinkJoined {
  id: string;
  project_id: string;
  is_active: boolean;
  revoked_at: string | null;
  projects: {
    id: string;
    title: string;
    description: string | null;
    published_version_id: string | null;
    owner_id: string;
  } | null;
}

export interface VersionRow {
  id: string;
  version_number: number;
  storage_path: string;
  upload_status: 'uploading' | 'ready' | 'failed';
  duration_seconds: string | number | null;
}

export interface CommentRow {
  id: string;
  parent_id: string | null;
  author_name: string;
  author_role: 'admin' | 'reviewer';
  body: string;
  timestamp_seconds: string;
  status: 'open' | 'resolved';
  created_at: string;
  updated_at: string;
}
