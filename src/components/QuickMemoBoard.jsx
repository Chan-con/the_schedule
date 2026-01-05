import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';

const MEMO_TABS_VERSION = 1;

const createMemoId = () => {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const safeJsonParse = (raw) => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
};

const normalizeIsoString = (value) => {
  if (!value) return '';
  const raw = String(value);
  const t = Date.parse(raw);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
};

const nowIso = () => new Date().toISOString();

const normalizeMemoTabsState = (rawValue) => {
  const parsed = safeJsonParse(rawValue);
  const isValidShape =
    parsed
    && parsed.version === MEMO_TABS_VERSION
    && Array.isArray(parsed.tabs);

  if (isValidShape) {
    const tabs = parsed.tabs
      .filter((tab) => tab && typeof tab === 'object')
      .map((tab, index) => {
        const id = typeof tab.id === 'string' && tab.id ? tab.id : `legacy-${index}`;
        const title = typeof tab.title === 'string' ? tab.title : '';
        const content = typeof tab.content === 'string' ? tab.content : '';
        const createdAt = normalizeIsoString(tab.createdAt || tab.created_at);
        const updatedAt = normalizeIsoString(tab.updatedAt || tab.updated_at);
        return { id, title, content, createdAt, updatedAt };
      });

    const safeTabs = tabs.length > 0 ? tabs : [{ id: createMemoId(), title: '', content: '', createdAt: nowIso(), updatedAt: nowIso() }];
    const activeTabId =
      typeof parsed.activeTabId === 'string' && safeTabs.some((t) => t.id === parsed.activeTabId)
        ? parsed.activeTabId
        : safeTabs[0].id;

    return { version: MEMO_TABS_VERSION, activeTabId, tabs: safeTabs };
  }

  // 既存形式(プレーンテキスト)は「メモ1」として扱う
  const legacyContent = typeof rawValue === 'string' ? rawValue : '';
  const id = createMemoId();
  const now = nowIso();
  return {
    version: MEMO_TABS_VERSION,
    activeTabId: id,
    tabs: [{ id, title: '', content: legacyContent, createdAt: now, updatedAt: now }],
  };
};

const serializeMemoTabsState = (state) => {
  return JSON.stringify({
    version: MEMO_TABS_VERSION,
    activeTabId: state.activeTabId,
    tabs: state.tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      content: tab.content,
      createdAt: tab.createdAt || '',
      updatedAt: tab.updatedAt || '',
    })),
  });
};

const normalizeText = (value) => (typeof value === 'string' ? value : '');
const normalizeForSearch = (value) => {
  const raw = normalizeText(value);
  let normalized = raw;
  try {
    normalized = normalized.normalize('NFKC');
  } catch {
    // ignore
  }
  return normalized.toLowerCase().replace(/\s+/g, ' ').trim();
};

const buildBigrams = (text) => {
  const s = normalizeForSearch(text);
  if (!s) return [];
  const grams = [];
  for (let i = 0; i < s.length - 1; i += 1) {
    grams.push(s.slice(i, i + 2));
  }
  return grams;
};

const scoreFuzzy = (content, query) => {
  const q = normalizeForSearch(query);
  if (!q) return 0;

  const c = normalizeForSearch(content);
  if (!c) return 0;

  const idx = c.indexOf(q);
  if (idx >= 0) {
    // 先頭に近いほど高得点
    return 2000 - Math.min(1500, idx);
  }

  const tokens = q.split(' ').filter(Boolean);
  let tokenScore = 0;
  tokens.forEach((t) => {
    if (!t) return;
    if (c.includes(t)) tokenScore += 120;
  });

  const qGrams = buildBigrams(q);
  const cGrams = buildBigrams(c);
  if (qGrams.length === 0 || cGrams.length === 0) return tokenScore;

  const qSet = new Set(qGrams);
  const cSet = new Set(cGrams);
  let overlap = 0;
  qSet.forEach((g) => {
    if (cSet.has(g)) overlap += 1;
  });

  const denom = Math.max(1, Math.min(qSet.size, cSet.size));
  const bigramScore = Math.round((overlap / denom) * 800);

  return tokenScore + bigramScore;
};

const toTime = (value) => {
  if (!value) return 0;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? 0 : t;
};

const AutoGrowTextarea = ({ value, onChange, onBlur, placeholder, className }) => {
  const ref = useRef(null);

  const syncHeight = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.max(0, el.scrollHeight)}px`;
  }, []);

  useEffect(() => {
    syncHeight();
  }, [syncHeight, value]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
      rows={1}
      className={className}
    />
  );
};

const QuickMemoBoard = React.forwardRef(({ value, onChange, className = '' }, ref) => {
  const [memoState, setMemoState] = useState(() => normalizeMemoTabsState(value));
  const [query, setQuery] = useState('');
  const lastEmittedRef = useRef(null);

  useEffect(() => {
    const lastEmitted = lastEmittedRef.current;
    if (typeof lastEmitted === 'string') {
      if (value === lastEmitted) {
        lastEmittedRef.current = null;
      }
      return;
    }

    const normalized = normalizeMemoTabsState(value);
    const incomingSerialized = serializeMemoTabsState(normalized);

    setMemoState((prev) => {
      const prevSerialized = serializeMemoTabsState(prev);
      if (prevSerialized === incomingSerialized) {
        return prev;
      }
      return normalized;
    });
  }, [value]);

  const commitState = useCallback((updater) => {
    setMemoState((prev) => {
      const nextState = typeof updater === 'function' ? updater(prev) : updater;
      if (onChange) {
        const serialized = serializeMemoTabsState(nextState);
        lastEmittedRef.current = serialized;
        onChange(serialized);
      }
      return nextState;
    });
  }, [onChange]);

  const addMemo = useCallback(() => {
    const now = nowIso();
    commitState((prev) => {
      const newTab = { id: createMemoId(), title: '', content: '', createdAt: now, updatedAt: now };
      return {
        ...prev,
        tabs: [newTab, ...prev.tabs],
        activeTabId: newTab.id,
      };
    });
  }, [commitState]);

  useImperativeHandle(ref, () => ({ addMemo }), [addMemo]);

  const handleChangeMemo = useCallback((tabId, nextContent) => {
    const now = nowIso();
    commitState((prev) => {
      const nextTabs = prev.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, content: nextContent, updatedAt: now, createdAt: tab.createdAt || now }
          : tab
      );
      return { ...prev, tabs: nextTabs, activeTabId: tabId };
    });
  }, [commitState]);

  const handleBlurMemo = useCallback((tabId) => {
    commitState((prev) => {
      const target = prev.tabs.find((t) => t.id === tabId);
      const content = normalizeText(target?.content);
      if (content.trim() !== '') return prev;

      // 空欄は削除。ただし0個にはしない。
      if (prev.tabs.length <= 1) {
        const only = prev.tabs[0] || { id: createMemoId(), title: '', content: '' };
        const now = nowIso();
        const normalizedOnly = { ...only, content: '', createdAt: only.createdAt || now, updatedAt: now };
        return { ...prev, tabs: [normalizedOnly], activeTabId: normalizedOnly.id };
      }

      const remainingTabs = prev.tabs.filter((t) => t.id !== tabId);
      const nextActive = remainingTabs[0] || remainingTabs[Math.max(0, remainingTabs.length - 1)];
      return {
        ...prev,
        tabs: remainingTabs,
        activeTabId: nextActive?.id || remainingTabs[0]?.id,
      };
    });
  }, [commitState]);

  const sortedTabs = useMemo(() => {
    const tabs = Array.isArray(memoState.tabs) ? [...memoState.tabs] : [];
    const q = normalizeForSearch(query);

    const withScore = tabs.map((tab) => {
      const score = q ? scoreFuzzy(tab?.content ?? '', q) : 0;
      return { tab, score };
    });

    withScore.sort((a, b) => {
      if (q) {
        const scoreDiff = (b.score || 0) - (a.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
      }

      const updatedDiff = toTime(b.tab?.updatedAt) - toTime(a.tab?.updatedAt);
      if (updatedDiff !== 0) return updatedDiff;
      const createdDiff = toTime(b.tab?.createdAt) - toTime(a.tab?.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return String(b.tab?.id ?? '').localeCompare(String(a.tab?.id ?? ''));
    });

    return withScore.map((row) => row.tab);
  }, [memoState.tabs, query]);

  return (
    <section className={`flex h-full min-h-0 flex-col overflow-hidden bg-white ${className}`}>
      <div className="px-4 pt-3 pb-2 bg-white">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="クイックメモを検索（本文）"
          className="w-full rounded-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-300"
        />
      </div>

      <div className="custom-scrollbar flex-1 overflow-y-auto px-4 pb-4 bg-white">
        <div className="[column-width:220px] [column-gap:12px]">
          {sortedTabs.map((tab) => {
            const tabId = tab?.id ?? null;
            if (!tabId) return null;
            const content = normalizeText(tab?.content);

            return (
              <div
                key={tabId}
                className="mb-3 break-inside-avoid rounded-lg border border-amber-200 bg-amber-50/70 p-3 shadow-sm"
              >
                <AutoGrowTextarea
                  value={content}
                  onChange={(event) => handleChangeMemo(tabId, event?.target?.value ?? '')}
                  onBlur={() => handleBlurMemo(tabId)}
                  placeholder="思いついたことを書き留めておけます"
                  className="w-full resize-none overflow-hidden bg-transparent text-sm leading-relaxed text-slate-900 outline-none"
                />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
});

QuickMemoBoard.displayName = 'QuickMemoBoard';

export default QuickMemoBoard;
