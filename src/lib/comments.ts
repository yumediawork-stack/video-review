import type { CommentNode, FlatComment } from './types';

/**
 * Утворює дерево коментарів із плоского списку (той самий компонент
 * використовується в адмінці та на review-сторінці).
 *
 * Правила:
 *  - вкладення один рівень: відповідь посилається на корінь тієї ж версії
 *    (гарантується схемою БД та сервером; тут довіряємо parentId);
 *  - у списку вже відсутні м'яко видалені коментарі (фільтр на сервері),
 *    тому відповіді видалених коренів природно втрачають батька й ховаються.
 */
export function buildCommentTree(flat: FlatComment[]): CommentNode[] {
  const byId = new Map<string, CommentNode>();
  for (const c of flat) {
    byId.set(c.id, { ...c, replies: [] });
  }
  const roots: CommentNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.replies.push(node);
    } else {
      roots.push(node);
    }
  }
  // Сортування: корені — за таймкодом, потім датою; відповіді — за датою.
  const byTime = (a: CommentNode, b: CommentNode) =>
    a.timestampSeconds - b.timestampSeconds ||
    a.createdAt.localeCompare(b.createdAt);
  const byDate = (a: CommentNode, b: CommentNode) => a.createdAt.localeCompare(b.createdAt);
  for (const node of byId.values()) {
    node.replies.sort(byDate);
  }
  roots.sort(byTime);
  return roots;
}

export function sortRootComments(roots: CommentNode[], mode: 'timecode' | 'date'): CommentNode[] {
  const copy = [...roots];
  copy.sort(
    mode === 'timecode'
      ? (a, b) => a.timestampSeconds - b.timestampSeconds || a.createdAt.localeCompare(b.createdAt)
      : (a, b) => b.createdAt.localeCompare(a.createdAt),
  );
  return copy;
}

export function countOpenComments(roots: CommentNode[]): number {
  let total = 0;
  const walk = (n: CommentNode) => {
    if (n.status === 'open') total += 1;
    n.replies.forEach(walk);
  };
  roots.forEach(walk);
  return total;
}
