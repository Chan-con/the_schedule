const NOTE_HASH_KEY = 'note';

const normalizeBaseUrl = (raw) => {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Remove any existing hash and trailing slashes
  return trimmed.replace(/#.*$/, '').replace(/\/+$/, '');
};

export const getPublicAppBaseUrl = () => {
  if (typeof window === 'undefined') return '';

  const envBase =
    normalizeBaseUrl(import.meta?.env?.VITE_PUBLIC_APP_URL)
    || normalizeBaseUrl(import.meta?.env?.VITE_SHARE_BASE_URL);

  if (envBase) return envBase;

  // Fallback: current origin/path (works for web/dev; file:// may yield a file path)
  try {
    const url = new URL(window.location.href);
    url.hash = '';
    url.search = '';

    // If we are on a file like index.html, keep the directory
    if (url.pathname && /\.[a-z0-9]+$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/[^/]*$/, '/');
    }

    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
};

const coerceNoteId = (raw) => {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  // If it's an integer-like id, use number so it matches existing state comparisons
  if (/^\d+$/.test(value)) {
    const asNumber = Number(value);
    if (Number.isSafeInteger(asNumber)) return asNumber;
  }
  return value;
};

export const parseNoteIdFromHash = (hash) => {
  const raw = typeof hash === 'string' ? hash : '';
  const trimmed = raw.replace(/^#/, '');
  if (!trimmed) return null;

  try {
    const params = new URLSearchParams(trimmed);
    return coerceNoteId(params.get(NOTE_HASH_KEY));
  } catch {
    return null;
  }
};

export const parseNoteIdFromUrl = (urlString) => {
  if (!urlString || typeof urlString !== 'string') return null;
  try {
    const url = new URL(urlString);
    return parseNoteIdFromHash(url.hash);
  } catch {
    // Not an absolute URL; try treat it as hash directly
    if (urlString.startsWith('#')) {
      return parseNoteIdFromHash(urlString);
    }
    return null;
  }
};

export const buildNoteShareUrl = (noteId) => {
  const base = getPublicAppBaseUrl();
  const id = noteId == null ? '' : String(noteId);
  if (!base || !id) return '';
  const params = new URLSearchParams();
  params.set(NOTE_HASH_KEY, id);
  return `${base}#${params.toString()}`;
};

export const setNoteHash = (noteId) => {
  if (typeof window === 'undefined') return;
  const id = noteId == null ? '' : String(noteId);
  if (!id) return;
  const params = new URLSearchParams();
  params.set(NOTE_HASH_KEY, id);
  window.location.hash = params.toString();
};

export const clearNoteHash = () => {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState(null, '', url.toString());
  } catch {
    window.location.hash = '';
  }
};
