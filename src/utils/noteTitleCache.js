import { fetchNoteForUserById } from './supabaseNotes';

const CACHE_TTL_MS = 10 * 60 * 1000;

// key: `${userId}:${noteId}`
const titleCache = new Map();

const now = () => Date.now();

const buildKey = (userId, id) => `${String(userId || '')}:${String(id ?? '')}`;

export const getCachedNoteTitle = ({ userId, id }) => {
  if (!userId || id == null) return null;
  const key = buildKey(userId, id);
  const entry = titleCache.get(key);
  if (!entry) return null;
  if (entry?.title) return entry.title;
  return null;
};

export const getNoteTitleCached = async ({ userId, id }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (id == null) throw new Error('ノートIDが指定されていません。');

  const key = buildKey(userId, id);
  const existing = titleCache.get(key);
  const ts = now();

  if (existing?.title && typeof existing.expiresAt === 'number' && existing.expiresAt > ts) {
    return existing.title;
  }

  if (existing?.promise) {
    return existing.promise;
  }

  const promise = (async () => {
    try {
      const note = await fetchNoteForUserById({ userId, id });
      const rawTitle = typeof note?.title === 'string' ? note.title : '';
      const title = rawTitle.trim() ? rawTitle.trim() : '無題のノート';
      titleCache.set(key, { title, expiresAt: now() + CACHE_TTL_MS });
      return title;
    } finally {
      const current = titleCache.get(key);
      if (current?.promise) {
        titleCache.set(key, { ...current, promise: null });
      }
    }
  })();

  titleCache.set(key, { promise, expiresAt: ts + CACHE_TTL_MS });
  return promise;
};

export const prefetchNoteTitles = async ({ userId, ids }) => {
  if (!userId) return;
  const list = Array.isArray(ids) ? ids : [];
  const unique = Array.from(new Set(list.filter((v) => v != null).map((v) => String(v))));
  if (unique.length === 0) return;

  await Promise.allSettled(
    unique.map((id) => getNoteTitleCached({ userId, id }))
  );
};
