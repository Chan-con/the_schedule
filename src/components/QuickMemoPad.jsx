import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const MEMO_TABS_VERSION = 1;

const createTabId = () => {
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
        return { id, title, content };
      });

    const safeTabs = tabs.length > 0 ? tabs : [{ id: createTabId(), title: '', content: '' }];
    const activeTabId =
      typeof parsed.activeTabId === 'string' && safeTabs.some((t) => t.id === parsed.activeTabId)
        ? parsed.activeTabId
        : safeTabs[0].id;

    return { version: MEMO_TABS_VERSION, activeTabId, tabs: safeTabs };
  }

  // 既存形式(プレーンテキスト)は「メモ1」として扱う
  const legacyContent = typeof rawValue === 'string' ? rawValue : '';
  const id = createTabId();
  return {
    version: MEMO_TABS_VERSION,
    activeTabId: id,
    tabs: [{ id, title: '', content: legacyContent }],
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
    })),
  });
};

const QuickMemoPad = ({ value, onChange, className = '', textareaClassName = '' }) => {
  const [memoState, setMemoState] = useState(() => normalizeMemoTabsState(value));
  const lastEmittedRef = useRef(null);

  useEffect(() => {
    const lastEmitted = lastEmittedRef.current;

    // 親がまだ追いついていない間はローカル状態を優先する
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

  const activeIndex = useMemo(() => {
    const idx = memoState.tabs.findIndex((tab) => tab.id === memoState.activeTabId);
    return idx >= 0 ? idx : 0;
  }, [memoState.activeTabId, memoState.tabs]);

  const activeTab = memoState.tabs[activeIndex] || memoState.tabs[0];
  const activeValue = activeTab?.content ?? '';

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

  const handleTabSelect = useCallback((tabId) => {
    if (!tabId) return;
    commitState((prev) => {
      if (tabId === prev.activeTabId) return prev;
      if (!prev.tabs.some((t) => t.id === tabId)) return prev;
      return { ...prev, activeTabId: tabId };
    });
  }, [commitState]);

  const handleAddTab = useCallback(() => {
    commitState((prev) => {
      const newTab = { id: createTabId(), title: '', content: '' };
      return {
        ...prev,
        tabs: [...prev.tabs, newTab],
        activeTabId: newTab.id,
      };
    });
  }, [commitState]);

  const handleChange = useCallback((event) => {
    const nextContent = event?.target?.value ?? '';
    commitState((prev) => {
      const nextTabs = prev.tabs.map((tab) =>
        tab.id === prev.activeTabId
          ? { ...tab, content: nextContent }
          : tab
      );
      return { ...prev, tabs: nextTabs };
    });
  }, [commitState]);

  const handleTextareaBlur = useCallback(() => {
    commitState((prev) => {
      const active = prev.tabs.find((tab) => tab.id === prev.activeTabId) || prev.tabs[0];
      const content = typeof active?.content === 'string' ? active.content : '';
      if (content.trim() !== '') return prev;

      // 空欄なら削除。ただし0個にはしない。
      if (prev.tabs.length <= 1) {
        const only = prev.tabs[0] || { id: createTabId(), title: '', content: '' };
        const normalizedOnly = { ...only, content: '' };
        return { ...prev, tabs: [normalizedOnly], activeTabId: normalizedOnly.id };
      }

      const remainingTabs = prev.tabs.filter((tab) => tab.id !== prev.activeTabId);
      const nextActive = remainingTabs[Math.max(0, remainingTabs.length - 1)] || remainingTabs[0];
      return {
        ...prev,
        tabs: remainingTabs,
        activeTabId: nextActive?.id || remainingTabs[0]?.id,
      };
    });
  }, [commitState]);

  return (
    <section
      className={`flex h-full min-h-0 flex-col rounded-md border border-indigo-900/20 bg-white/95 p-2 shadow-xl shadow-indigo-900/30 backdrop-blur ${className}`}
    >
      <div className="flex flex-1 min-h-0 flex-col">
        <div className="flex items-end justify-between px-1 -mb-px">
          <div
            className="no-scrollbar flex max-w-full items-end gap-px overflow-x-auto overflow-y-hidden pr-1"
            role="tablist"
            aria-label="メモタブ"
          >
            {memoState.tabs.map((tab, index) => {
              const isActive = tab.id === memoState.activeTabId;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  aria-label={`メモタブ ${index + 1}`}
                  onClick={() => handleTabSelect(tab.id)}
                  className={
                    `relative shrink-0 w-9 h-6 rounded-t-lg rounded-b-none border border-indigo-900/20 text-[11px] font-semibold leading-none transition focus:outline-none focus-visible:outline-none hover:border-indigo-900/20 focus:border-indigo-900/20 focus-visible:border-indigo-900/20 -mb-px `
                    + (isActive
                      ? 'z-10 bg-white text-indigo-900 border-b-white'
                      : 'bg-indigo-50/60 text-indigo-900 hover:bg-white border-b-indigo-900/20')
                  }
                >
                  <span className="sr-only">{`メモタブ ${index + 1}`}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleAddTab}
            className="shrink-0 h-6 w-6 appearance-none border-0 bg-transparent p-0 text-indigo-700 transition hover:text-indigo-900 focus:outline-none focus-visible:outline-none"
            aria-label="メモのタブを追加"
            title="タブを追加"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 rounded-md border border-indigo-900/20 bg-white/90">
          <textarea
            value={activeValue}
            onChange={handleChange}
            onBlur={handleTextareaBlur}
            placeholder="思いついたことを書き留めておけます"
            className={`custom-scrollbar h-full w-full resize-none overflow-auto rounded-md bg-transparent px-2 py-2 text-sm text-gray-900 outline-none min-h-0 ${textareaClassName}`}
          />
        </div>
      </div>
    </section>
  );
};

export default QuickMemoPad;
