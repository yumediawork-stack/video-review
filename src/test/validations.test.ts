import { describe, expect, it } from 'vitest';
import { validateAuthorName, validateCommentText, checkVideoFile, validateTimestampSeconds } from '../lib/validations';
import { ApiError } from '../lib/types';
import { buildCommentTree, countOpenComments, sortRootComments } from '../lib/comments';
import type { FlatComment } from '../lib/types';

const comment = (over: Partial<FlatComment>): FlatComment => ({
  id: 'x',
  parentId: null,
  authorName: 'Ім я',
  authorRole: 'reviewer',
  body: 'текст',
  timestampSeconds: 1,
  status: 'open',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  ...over,
});

describe('валідація полів форми', () => {
  it('ім’я: обрізає пробіли, 1..60', () => {
    expect(validateAuthorName('  Марія ')).toEqual({ ok: true, value: 'Марія' });
    expect(validateAuthorName('   ').ok).toBe(false);
    expect(validateAuthorName('a'.repeat(61)).ok).toBe(false);
  });
  it('текст: 1..2000', () => {
    expect(validateCommentText('зробити плавніше').ok).toBe(true);
    expect(validateCommentText('').ok).toBe(false);
    expect(validateCommentText('x'.repeat(2001)).ok).toBe(false);
  });
  it('таймкод: >= 0, <= duration + 1.5', () => {
    expect(validateTimestampSeconds(12.4, 120).ok).toBe(true);
    expect(validateTimestampSeconds(-1).ok).toBe(false);
    expect(validateTimestampSeconds(130, 120).ok).toBe(false);
    expect(validateTimestampSeconds(121.4, 120).ok).toBe(true); // tolerance
    expect(validateTimestampSeconds('not-a-number').ok).toBe(false);
  });
  it('checkVideoFile: тільки .mp4', () => {
    const ok = new File([new Uint8Array([1, 2, 3])], 'video.mp4', { type: 'video/mp4' });
    const bad = new File([new Uint8Array([1, 2, 3])], 'video.mkv', { type: 'video/x-matroska' });
    expect(checkVideoFile(ok).ok).toBe(true);
    const badRes = checkVideoFile(bad);
    if (!badRes.ok) {
      expect(badRes.error).toContain('.mp4');
    } else {
      throw new Error('очікувалась відмова для .mkv');
    }
  });
});

describe('обробка статусів помилок API (ApiError)', () => {
  it('зберігає код/статус', () => {
    const e = new ApiError('version_changed', 409, 'Доступна нова версія.');
    expect(e.code).toBe('version_changed');
    expect(e.status).toBe(409);
    expect(e.message).toContain('нова версія');
  });
});

describe('buildCommentTree', () => {
  const flat: FlatComment[] = [
    comment({ id: 'r1', timestampSeconds: 12 }),
    comment({ id: 'r1.1', parentId: 'r1', createdAt: new Date(100).toISOString() }),
    comment({ id: 'r1.2', parentId: 'r1', createdAt: new Date(50).toISOString() }),
    comment({ id: 'r2', timestampSeconds: 5 }),
    // «сирота» без батька йде як корінь
    comment({ id: 'orphan', parentId: 'deleted-root', timestampSeconds: 60 }),
  ];
  it('один рівень вкладень + сортування коренів за таймкодом', () => {
    const tree = buildCommentTree(flat);
    expect(tree.map((n) => n.id)).toEqual(['r2', 'r1', 'orphan']);
    const r1 = tree[1];
    expect(r1.replies.map((x) => x.id)).toEqual(['r1.2', 'r1.1']);
  });
  it('sortRootComments date: новіші зверху', () => {
    const sorted = sortRootComments(buildCommentTree(flat) as never, 'date');
    const dates = sorted.map((n) => n.createdAt);
    const desc = [...dates].sort((a, b) => b.localeCompare(a));
    expect(dates).toEqual(desc);
  });
  it('countOpenComments рахує відповіді теж', () => {
    const flat2: FlatComment[] = [
      comment({ id: 'a', status: 'resolved' }),
      comment({ id: 'b' }),
      comment({ id: 'b.1', parentId: 'b' as string }),
    ];
    const n = countOpenComments(buildCommentTree(flat2));
    expect(n).toBe(2); // b + b.1
  });
});
