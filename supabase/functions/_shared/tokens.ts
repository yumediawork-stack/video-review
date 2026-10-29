/**
 * Токени доступу: генерація і хешування.
 *  - raw token — 32 випадкових байти у base64url (≈43 символи);
 *  - у БД зберігається ЛИШЕ hex-хеш: HMAC-SHA256(token, REVIEW_TOKEN_PEPPER),
 *    якщо pepper заданий, інакше SHA-256(token);
 *  - raw токен повертається админу рівно один раз при створенні посилання.
 *  УВАГА: зміна REVIEW_TOKEN_PEPPER робить всі активні посилання недійсними
 *  (доведеться перевипустити нові). Документуйте це в SETUP.md.
 */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,60}$/;

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashToken(token: string): Promise<string> {
  const pepper = Deno.env.get('REVIEW_TOKEN_PEPPER') ?? '';
  const enc = new TextEncoder();
  if (pepper) {
    const key = await crypto.subtle.importKey('raw', enc.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(token));
    return bytesToHex(sig);
  }
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(token));
  return bytesToHex(digest);
}

export function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
