import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import MemoWithLinks from './MemoWithLinks';

const MEMO_TABS_VERSION = 1;
const QUICK_MEMO_COLUMN_PREFERRED_WIDTH = 220;
const QUICK_MEMO_COLUMN_GAP = 12;
const QUICK_MEMO_LOOKAHEAD = 8;

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
        const pinnedAt = normalizeIsoString(tab.pinnedAt || tab.pinned_at);
        return { id, title, content, createdAt, updatedAt, pinnedAt };
      });

    const safeTabs = tabs.length > 0 ? tabs : [{ id: createMemoId(), title: '', content: '', createdAt: nowIso(), updatedAt: nowIso(), pinnedAt: '' }];
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
    tabs: [{ id, title: '', content: legacyContent, createdAt: now, updatedAt: now, pinnedAt: '' }],
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
      pinnedAt: tab.pinnedAt || '',
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

const matchesQuery = (content, query) => {
  const q = normalizeForSearch(query);
  if (!q) return true;
  const c = normalizeForSearch(content);
  if (!c) return false;
  const tokens = q.split(' ').filter(Boolean);
  return tokens.every((t) => c.includes(t));
};

const toTime = (value) => {
  if (!value) return 0;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? 0 : t;
};

const estimateCardHeight = (content, columnWidth) => {
  const text = typeof content === 'string' ? content : '';
  if (!text) return 80;
  const w = typeof columnWidth === 'number' && Number.isFinite(columnWidth) ? columnWidth : QUICK_MEMO_COLUMN_PREFERRED_WIDTH;
  // padding(左右)ざっくり + スクロールバー等の余白を差し引いた幅
  const usablePx = Math.max(120, w - 32);
  // 1文字あたりの平均幅をざっくり7pxとして折返し行数を推定
  const charsPerLine = Math.max(18, Math.floor(usablePx / 7));
  const lines = text.split('\n');
  const lineCount = Math.max(1, lines.length);
  const roughChars = text.length;
  const wrappedLines = Math.ceil(roughChars / Math.max(1, charsPerLine));
  const effectiveLines = Math.max(lineCount, wrappedLines);
  return 56 + effectiveLines * 18;
};

const QuickMemoContent = ({ value, placeholder, className, previewClassName = '' }) => {
  const safeValue = typeof value === 'string' ? value : '';
  const hasContent = safeValue.trim() !== '';

  return (
    <div className={`${className} ${previewClassName}`}>
      {hasContent
        ? <MemoWithLinks memo={safeValue} className="text-sm leading-relaxed text-slate-900" />
        : <span className="text-sm leading-relaxed text-slate-500">{placeholder}</span>}
    </div>
  );
};

const QuickMemoEditModal = ({
  isOpen,
  title,
  value,
  onChange,
  onClose,
  onSave,
  onDelete,
  isSaveDisabled,
  isDeleteMode,
}) => {
  const textareaRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEsc);

    const id = globalThis.requestAnimationFrame
      ? globalThis.requestAnimationFrame(() => textareaRef.current?.focus())
      : setTimeout(() => textareaRef.current?.focus(), 0);

    return () => {
      window.removeEventListener('keydown', handleEsc);
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
      if (globalThis.cancelAnimationFrame && typeof id === 'number') {
        globalThis.cancelAnimationFrame(id);
      } else {
        clearTimeout(id);
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="flex w-full max-w-xl max-h-[90svh] flex-col overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: 0 }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition hover:bg-gray-50"
            aria-label="閉じる"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4">
          <textarea
            ref={textareaRef}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="思いついたことを書き留めておけます"
            className="w-full min-h-[40svh] resize-none rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/40"
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={isDeleteMode ? onDelete : onSave}
            disabled={isDeleteMode ? false : isSaveDisabled}
            className={`rounded-full px-4 py-2 text-sm font-semibold text-white transition ${
              isDeleteMode
                ? 'bg-rose-600 hover:bg-rose-700'
                : (isSaveDisabled ? 'cursor-not-allowed bg-indigo-300' : 'bg-indigo-600 hover:bg-indigo-700')
            }`}
          >
            {isDeleteMode ? '削除' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
};

const QuickMemoBoard = React.forwardRef(({ value, onChange, onImmediatePersist, className = '' }, ref) => {
  const [memoState, setMemoState] = useState(() => normalizeMemoTabsState(value));
  const [query, setQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('edit');
  const [modalTabId, setModalTabId] = useState(null);
  const [modalDraft, setModalDraft] = useState('');
  const boardRef = useRef(null);
  const [columnCount, setColumnCount] = useState(1);
  const [columnWidth, setColumnWidth] = useState(QUICK_MEMO_COLUMN_PREFERRED_WIDTH);
  const itemHeightsRef = useRef(new Map());
  const [heightVersion, setHeightVersion] = useState(0);
  const lastEmittedRef = useRef(null);
  const dirtyMemoIdsRef = useRef(new Set());

  useEffect(() => {
    const el = boardRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const update = () => {
      const width = el.clientWidth || 0;
      const count = Math.max(
        1,
        Math.floor((width + QUICK_MEMO_COLUMN_GAP) / (QUICK_MEMO_COLUMN_PREFERRED_WIDTH + QUICK_MEMO_COLUMN_GAP))
      );
      setColumnCount((prev) => (prev === count ? prev : count));

      const available = Math.max(0, width - QUICK_MEMO_COLUMN_GAP * Math.max(0, count - 1));
      const nextColWidth = Math.max(160, Math.floor(available / count));
      setColumnWidth((prev) => (prev === nextColWidth ? prev : nextColWidth));
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const registerCardEl = useCallback((tabId, el) => {
    if (!tabId || !el) return;
    const rect = el.getBoundingClientRect?.();
    const next = rect?.height;
    if (typeof next !== 'number' || !Number.isFinite(next)) return;
    const rounded = Math.max(0, Math.round(next));
    const prev = itemHeightsRef.current.get(String(tabId));
    if (typeof prev === 'number' && Math.abs(prev - rounded) <= 1) return;
    itemHeightsRef.current.set(String(tabId), rounded);
    setHeightVersion((v) => v + 1);
  }, []);

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

  const openCreate = useCallback(() => {
    setModalMode('new');
    setModalTabId(null);
    setModalDraft('');
    setIsModalOpen(true);
  }, []);

  const openEdit = useCallback((tabId) => {
    const target = memoState.tabs.find((t) => t.id === tabId);
    setModalMode('edit');
    setModalTabId(tabId);
    setModalDraft(normalizeText(target?.content));
    setIsModalOpen(true);
  }, [memoState.tabs]);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const _handleBlurMemo = useCallback((tabId) => {
    commitState((prev) => {
      const target = prev.tabs.find((t) => t.id === tabId);
      const content = normalizeText(target?.content);
      if (content.trim() !== '') return prev;

      dirtyMemoIdsRef.current.delete(String(tabId));

      // 空欄は削除。ただし0個にはしない。
      if (prev.tabs.length <= 1) {
        const only = prev.tabs[0] || { id: createMemoId(), title: '', content: '' };
        const now = nowIso();
        const normalizedOnly = { ...only, content: '', createdAt: only.createdAt || now, updatedAt: now, pinnedAt: only.pinnedAt || '' };
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

  const deleteMemoById = useCallback((tabId) => {
    if (!tabId) return;
    const now = nowIso();

    commitState((prev) => {
      const exists = prev.tabs.some((t) => t.id === tabId);
      if (!exists) return prev;

      dirtyMemoIdsRef.current.delete(String(tabId));

      // 0個にはしない（最後の1つは空欄にする）
      if (prev.tabs.length <= 1) {
        const only = prev.tabs[0] || { id: createMemoId(), title: '', content: '' };
        const normalizedOnly = {
          ...only,
          content: '',
          createdAt: only.createdAt || now,
          updatedAt: now,
          pinnedAt: only.pinnedAt || '',
        };
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

  const saveModal = useCallback(() => {
    const text = normalizeText(modalDraft);
    const trimmed = text.trim();

    if (modalMode === 'new') {
      if (!trimmed) {
        closeModal();
        return;
      }

      const now = nowIso();
      commitState((prev) => {
        const newTab = { id: createMemoId(), title: '', content: text, createdAt: now, updatedAt: now, pinnedAt: '' };
        return {
          ...prev,
          tabs: [newTab, ...prev.tabs],
          activeTabId: newTab.id,
        };
      });

      closeModal();
      return;
    }

    const tabId = modalTabId;
    if (!tabId) {
      closeModal();
      return;
    }

    if (!trimmed) {
      // 空欄は削除（ただし0個にはしない）
      deleteMemoById(tabId);
      closeModal();
      return;
    }

    const now = nowIso();
    commitState((prev) => {
      const exists = prev.tabs.some((t) => t.id === tabId);
      if (!exists) return prev;
      const nextTabs = prev.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, content: text, createdAt: tab.createdAt || now, updatedAt: now }
          : tab
      );
      return { ...prev, tabs: nextTabs, activeTabId: tabId };
    });

    closeModal();
  }, [closeModal, commitState, deleteMemoById, modalDraft, modalMode, modalTabId]);

  const deleteModal = useCallback(() => {
    const tabId = modalTabId;
    if (!tabId) {
      closeModal();
      return;
    }
    deleteMemoById(tabId);
    closeModal();
  }, [closeModal, deleteMemoById, modalTabId]);

  // 互換: 既存の + ボタンは addMemo() を呼んでいるので、モーダルを開く動作に置き換える
  const addMemo = useCallback(() => {
    openCreate();
  }, [openCreate]);

  useImperativeHandle(ref, () => ({ addMemo, openCreate, openEdit }), [addMemo, openCreate, openEdit]);

  const _handleChangeMemo = useCallback((tabId, nextContent) => {
    commitState((prev) => {
      const current = prev.tabs.find((t) => t.id === tabId);
      const currentContent = normalizeText(current?.content);
      if (currentContent !== nextContent) {
        dirtyMemoIdsRef.current.add(String(tabId));
      }
      const nextTabs = prev.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, content: nextContent, createdAt: tab.createdAt || nowIso(), updatedAt: tab.updatedAt || tab.createdAt || '' }
          : tab
      );
      return { ...prev, tabs: nextTabs, activeTabId: tabId };
    });
  }, [commitState]);

  const _commitUpdatedAtOnBlur = useCallback((tabId) => {
    const key = String(tabId);
    if (!dirtyMemoIdsRef.current.has(key)) return;
    const now = nowIso();
    dirtyMemoIdsRef.current.delete(key);
    commitState((prev) => {
      const target = prev.tabs.find((t) => t.id === tabId);
      const content = normalizeText(target?.content);
      if (content.trim() === '') return prev;

      const nextTabs = prev.tabs.map((tab) =>
        tab.id === tabId
          ? { ...tab, updatedAt: now, createdAt: tab.createdAt || now }
          : tab
      );
      return { ...prev, tabs: nextTabs };
    });
  }, [commitState]);

  const togglePinMemo = useCallback((tabId) => {
    const now = nowIso();
    setMemoState((prev) => {
      const exists = prev.tabs.some((t) => t.id === tabId);
      if (!exists) return prev;

      const nextTabs = prev.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        const pinnedAt = normalizeIsoString(tab.pinnedAt);
        const nextPinnedAt = pinnedAt ? '' : now;
        // ピン留めは並び順のためのメタ情報なので、updatedAtは更新しない
        return { ...tab, pinnedAt: nextPinnedAt };
      });

      const nextState = { ...prev, tabs: nextTabs, activeTabId: tabId };

      if (onChange) {
        const serialized = serializeMemoTabsState(nextState);
        lastEmittedRef.current = serialized;
        onChange(serialized);
        if (typeof onImmediatePersist === 'function') {
          onImmediatePersist(serialized);
        }
      }

      return nextState;
    });
  }, [onChange, onImmediatePersist]);

  const searchQuery = useMemo(() => normalizeForSearch(query), [query]);
  const isSearching = !!searchQuery;

  const sortedTabs = useMemo(() => {
    const tabs = Array.isArray(memoState.tabs) ? [...memoState.tabs] : [];
    const q = searchQuery;
    const localIsSearching = !!q;

    const filtered = localIsSearching
      ? tabs.filter((tab) => matchesQuery(tab?.content ?? '', q))
      : tabs;

    filtered.sort((a, b) => {
      // 検索中は「ピン留めを無視」して更新順で表示
      if (!localIsSearching) {
        const aPinned = !!normalizeIsoString(a?.pinnedAt);
        const bPinned = !!normalizeIsoString(b?.pinnedAt);
        if (aPinned !== bPinned) return aPinned ? -1 : 1;

        const pinnedDiff = toTime(b?.pinnedAt) - toTime(a?.pinnedAt);
        if (pinnedDiff !== 0) return pinnedDiff;
      }

      const updatedDiff = toTime(b?.updatedAt) - toTime(a?.updatedAt);
      if (updatedDiff !== 0) return updatedDiff;
      const createdDiff = toTime(b?.createdAt) - toTime(a?.createdAt);
      if (createdDiff !== 0) return createdDiff;
      return String(b?.id ?? '').localeCompare(String(a?.id ?? ''));
    });

    return filtered;
  }, [memoState.tabs, searchQuery]);

  const { pinnedTabs, normalTabs } = useMemo(() => {
    if (isSearching) {
      return { pinnedTabs: [], normalTabs: sortedTabs };
    }
    const pinned = [];
    const normal = [];
    (Array.isArray(sortedTabs) ? sortedTabs : []).forEach((tab) => {
      const pinnedAt = normalizeIsoString(tab?.pinnedAt);
      if (pinnedAt) {
        pinned.push(tab);
      } else {
        normal.push(tab);
      }
    });
    return { pinnedTabs: pinned, normalTabs: normal };
  }, [isSearching, sortedTabs]);

  const buildMasonryColumns = useCallback((tabs, { lookahead = QUICK_MEMO_LOOKAHEAD, anchorFirst = true } = {}) => {
    const count = Math.max(1, columnCount);
    const cols = Array.from({ length: count }, () => []);
    const heights = Array.from({ length: count }, () => 0);

    const getHeight = (tab) => {
      const id = String(tab?.id ?? '');
      if (!id) return estimateCardHeight(tab?.content);
      const measured = itemHeightsRef.current.get(id);
      return typeof measured === 'number' ? measured : estimateCardHeight(tab?.content, columnWidth);
    };

    const queue = Array.isArray(tabs) ? [...tabs] : [];

    // 1列レイアウトは“上から順番に”が一番わかりやすいので、背の高さ最適化はしない
    if (count === 1) {
      cols[0] = queue;
      return cols;
    }

    // 先頭（= 新規/更新が一番新しいもの）を必ず左上の軸に固定する
    if (anchorFirst && queue.length > 0) {
      const first = queue.shift();
      cols[0].push(first);
      heights[0] += Math.max(0, getHeight(first));
    }

    const safeLookahead = Math.max(1, Number.isFinite(lookahead) ? Math.floor(lookahead) : QUICK_MEMO_LOOKAHEAD);

    while (queue.length > 0) {
      // 一番短い列を探す
      let targetCol = 0;
      let minHeight = heights[0] ?? 0;
      for (let i = 1; i < heights.length; i += 1) {
        if (heights[i] < minHeight) {
          minHeight = heights[i];
          targetCol = i;
        }
      }

      // 直近の順序を大きく崩さない範囲で「背の高いカード」を優先
      const lookaheadCount = Math.min(queue.length, safeLookahead);
      let bestIdxInQueue = 0;
      let bestHeightOfItem = getHeight(queue[0]);
      for (let i = 1; i < lookaheadCount; i += 1) {
        const h = getHeight(queue[i]);
        if (h > bestHeightOfItem) {
          bestHeightOfItem = h;
          bestIdxInQueue = i;
        }
      }

      const tab = queue.splice(bestIdxInQueue, 1)[0];
      cols[targetCol].push(tab);
      heights[targetCol] += Math.max(0, bestHeightOfItem);
    }

    return cols;
  }, [columnCount, columnWidth]);

  const masonryColumnsPinned = useMemo(
    () => {
      void heightVersion;
      return buildMasonryColumns(pinnedTabs, { lookahead: 1 });
    },
    [buildMasonryColumns, pinnedTabs, heightVersion]
  );

  const masonryColumnsNormal = useMemo(
    () => {
      void heightVersion;
      return buildMasonryColumns(normalTabs);
    },
    [buildMasonryColumns, normalTabs, heightVersion]
  );

  return (
    <section className={`flex h-full min-h-0 flex-col overflow-hidden bg-white ${className}`}>
      <QuickMemoEditModal
        isOpen={isModalOpen}
        title={modalMode === 'new' ? 'クイックメモを追加' : 'クイックメモを編集'}
        value={modalDraft}
        onChange={setModalDraft}
        onClose={closeModal}
        onSave={saveModal}
        onDelete={deleteModal}
        isDeleteMode={modalMode === 'edit' && modalDraft.trim() === ''}
        isSaveDisabled={modalMode === 'new' ? modalDraft.trim() === '' : false}
      />

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
        <div ref={boardRef}>
          {!isSearching && pinnedTabs.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 flex items-center gap-2 text-xs text-amber-600">
                <span className="flex-1 h-px bg-amber-100" />
                <span className="tracking-wide">ピン留め</span>
                <span className="flex-1 h-px bg-amber-100" />
              </div>

              <div className="flex items-start justify-start" style={{ gap: `${QUICK_MEMO_COLUMN_GAP}px` }}>
                {masonryColumnsPinned.map((col, colIndex) => (
                  <div
                    key={`pinned-col-${colIndex}`}
                    className="flex flex-col"
                    style={{ width: `${columnWidth}px`, gap: `${QUICK_MEMO_COLUMN_GAP}px` }}
                  >
                    {col.map((tab) => {
                      const tabId = tab?.id ?? null;
                      if (!tabId) return null;
                      const content = normalizeText(tab?.content);
                      const isPinned = !!normalizeIsoString(tab?.pinnedAt);

                      return (
                        <div
                          key={tabId}
                          ref={(el) => registerCardEl(tabId, el)}
                          className="relative break-inside-avoid rounded-lg border border-amber-200 bg-amber-50/70 p-3 shadow-sm"
                          onDoubleClick={() => openEdit(tabId)}
                        >
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              togglePinMemo(tabId);
                            }}
                            style={{ padding: 0 }}
                            className={`absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border bg-white/80 text-amber-700 transition hover:bg-white ${
                              isPinned ? 'border-amber-300' : 'border-transparent opacity-60 hover:opacity-100'
                            }`}
                            aria-label={isPinned ? 'ピン留めを解除' : 'ピン留め'}
                            title={isPinned ? 'ピン留め中（クリックで解除）' : 'クリックでピン留め'}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-3 w-3"
                            >
                              <path d="M12 17v5" />
                              <path d="M5 9l14 0" />
                              <path d="M9 9V3h6v6" />
                              <path d="M9 9l-2 4h10l-2-4" />
                            </svg>
                            <span className="sr-only">{isPinned ? 'ピン留め中' : '未ピン留め'}</span>
                          </button>

                          <QuickMemoContent
                            value={content}
                            placeholder="思いついたことを書き留めておけます"
                            className="w-full overflow-hidden bg-transparent"
                            previewClassName="min-h-[1.25rem] cursor-text whitespace-pre-wrap"
                          />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>

              {normalTabs.length > 0 && (
                <div className="mt-4 flex items-center gap-2 text-xs text-gray-300">
                  <span className="flex-1 h-px bg-gray-100" />
                  <span className="tracking-wide">すべて</span>
                  <span className="flex-1 h-px bg-gray-100" />
                </div>
              )}
            </div>
          )}

          {(isSearching || pinnedTabs.length === 0 || normalTabs.length > 0) && (
            <div className="flex items-start justify-start" style={{ gap: `${QUICK_MEMO_COLUMN_GAP}px` }}>
              {masonryColumnsNormal.map((col, colIndex) => (
                <div
                  key={`col-${colIndex}`}
                  className="flex flex-col"
                  style={{ width: `${columnWidth}px`, gap: `${QUICK_MEMO_COLUMN_GAP}px` }}
                >
                  {col.map((tab) => {
                    const tabId = tab?.id ?? null;
                    if (!tabId) return null;
                    const content = normalizeText(tab?.content);
                    const isPinned = !!normalizeIsoString(tab?.pinnedAt);

                    return (
                      <div
                        key={tabId}
                        ref={(el) => registerCardEl(tabId, el)}
                        className="relative break-inside-avoid rounded-lg border border-amber-200 bg-amber-50/70 p-3 shadow-sm"
                        onDoubleClick={() => openEdit(tabId)}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            togglePinMemo(tabId);
                          }}
                          style={{ padding: 0 }}
                          className={`absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border bg-white/80 text-amber-700 transition hover:bg-white ${
                            isPinned ? 'border-amber-300' : 'border-transparent opacity-60 hover:opacity-100'
                          }`}
                          aria-label={isPinned ? 'ピン留めを解除' : 'ピン留め'}
                          title={isPinned ? 'ピン留め中（クリックで解除）' : 'クリックでピン留め'}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-3 w-3"
                          >
                            <path d="M12 17v5" />
                            <path d="M5 9l14 0" />
                            <path d="M9 9V3h6v6" />
                            <path d="M9 9l-2 4h10l-2-4" />
                          </svg>
                          <span className="sr-only">{isPinned ? 'ピン留め中' : '未ピン留め'}</span>
                        </button>

                        <QuickMemoContent
                          value={content}
                          placeholder="思いついたことを書き留めておけます"
                          className="w-full overflow-hidden bg-transparent"
                          previewClassName="min-h-[1.25rem] cursor-text whitespace-pre-wrap"
                        />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
});

QuickMemoBoard.displayName = 'QuickMemoBoard';

export default QuickMemoBoard;
