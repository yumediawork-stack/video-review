import { describe, expect, it } from 'vitest';
import { buildAgentStreamUrl, isAgentOnline } from '../lib/stream';

describe('агент-трансляція', () => {
  it('URL версії: <base>/v/<id>.mp4, прибирає trailing slash', () => {
    const id = '9f1e2d3c-4b5a-6978-8c9d-0e1f2a3b4c5d';
    expect(buildAgentStreamUrl('https://x.trycloudflare.com', id)).toBe(`https://x.trycloudflare.com/v/${id}.mp4`);
    expect(buildAgentStreamUrl('https://x.trycloudflare.com///', id)).toBe(`https://x.trycloudflare.com/v/${id}.mp4`);
  });

  it('онлайн-статус: свіжий heartbeat (<2 хв) → true, старий/свідерний → false', () => {
    const now = Date.now();
    const fresh = new Date(now - 30_000).toISOString();
    const stale = new Date(now - 5 * 60_000).toISOString();
    expect(isAgentOnline(fresh, now)).toBe(true);
    expect(isAgentOnline(stale, now)).toBe(false);
    expect(isAgentOnline(null, now)).toBe(false);
    expect(isAgentOnline('мусор', now)).toBe(false);
  });
});
