/**
 * ПРОСТИЙ rate limiter в пам'яті інстанса функції (fixed window).
 * ОБМЕЖЕННЯ: Edge Functions масштабуються горизонтально — лічильники локальні
 * для кожного інстанса і скидаються при cold start. Це базовий захист від спаму,
 * А НЕ строгий ліміт; для гарантий підключіть edge rate limiting на рівні
 * платформи (наприклад, WAF/CDN або Redis). Чесне попередження, як і вимагало ТЗ.
 */
interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function rateLimit(name: string, key: string, max: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const k = `${name}:${key}`;
  const b = buckets.get(k);
  if (!b || b.resetAt <= now) {
    buckets.set(k, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) {
      // протикання витоку ключів
      for (const [bk, bb] of buckets) if (bb.resetAt <= now) buckets.delete(bk);
    }
    return { allowed: true, retryAfterSec: 0 };
  }
  b.count += 1;
  if (b.count > max) {
    return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function clientKey(req: Request, fallback: string): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('cf-connecting-ip') ?? '';
  return ip || fallback;
}
