import React, { useEffect, useMemo, useRef, useCallback } from 'react';

const IconSearch = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

const IconEmpty = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
    <path d="M8.5 8.5l5 5" />
    <path d="M13.5 8.5l-5 5" />
  </svg>
);

function ScheduleSearchModal({
  isOpen,
  keyword,
  onKeywordChange,
  results,
  loading,
  onClose,
  onSelect,
}) {
  const inputRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus?.();
      inputRef.current?.select?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const list = useMemo(() => (Array.isArray(results) ? results : []), [results]);

  const formatLabel = useCallback((item) => {
    const date = typeof item?.date === 'string' ? item.date : '';
    const time = typeof item?.time === 'string' ? item.time : '';
    const name = typeof item?.name === 'string' ? item.name : '';
    const isTask = !!item?.isTask;
    const completed = !!item?.completed;

    const kind = isTask ? (completed ? 'タスク(完了)' : 'タスク') : '予定';
    const head = [date, time].filter(Boolean).join(' ');
    return {
      title: name || '名称未設定',
      meta: [head, kind].filter(Boolean).join(' / '),
    };
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="予定/タスク検索"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <IconSearch className="h-4 w-4 text-gray-600" />
            予定/タスク検索
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            aria-label="閉じる"
            title="閉じる"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-3">
          <label className="block text-xs font-semibold text-gray-600" htmlFor="schedule-search-input">キーワード（タイトル/メモ）</label>
          <input
            id="schedule-search-input"
            ref={inputRef}
            type="text"
            value={typeof keyword === 'string' ? keyword : ''}
            onChange={(e) => onKeywordChange?.(e.target.value)}
            placeholder="例: 支払い / ミーティング / 病院"
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
          />

          <div className="mt-3 min-h-[160px]">
            {loading ? (
              <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 text-gray-500">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-500" aria-hidden="true" />
                <div className="text-sm">検索中…</div>
              </div>
            ) : list.length === 0 ? (
              <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 text-gray-400">
                <IconEmpty className="h-8 w-8" />
                <div className="text-sm">候補がありません</div>
              </div>
            ) : (
              <div className="custom-scrollbar max-h-[55vh] overflow-y-auto rounded-lg border border-gray-200">
                {list.map((item) => {
                  const key = String(item?.id ?? `${item?.date ?? 'unknown'}:${item?.name ?? ''}`);
                  const { title, meta } = formatLabel(item);
                  const memo = typeof item?.memo === 'string' ? item.memo.trim() : '';
                  const memoLine = memo ? (memo.length > 80 ? `${memo.slice(0, 80)}…` : memo) : '';

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onSelect?.(item)}
                      className="w-full border-b border-gray-100 px-3 py-2 text-left hover:bg-indigo-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                    >
                      <div className="text-sm font-semibold text-gray-800 truncate">{title}</div>
                      <div className="mt-0.5 text-xs text-gray-500 truncate">{meta}</div>
                      {memoLine && <div className="mt-1 text-xs text-gray-400 truncate">{memoLine}</div>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ScheduleSearchModal;
