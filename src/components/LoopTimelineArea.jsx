import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const clampInt = (value, { min = 0, max = 10_000, fallback = 0 } = {}) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.floor(numeric);
  return Math.min(Math.max(rounded, min), max);
};

const formatClock = (value) => {
  if (!value) return '';
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const computeLoopProgress = ({ now, startAt, durationMinutes }) => {
  const durationMs = Math.max(1, durationMinutes) * 60_000;
  if (!startAt) {
    return {
      state: 'idle',
      offsetMs: 0,
      loopIndex: 0,
      remainingToStartMs: null,
    };
  }

  const start = startAt instanceof Date ? startAt : new Date(startAt);
  const startMs = start.getTime();
  const nowMs = now.getTime();

  if (Number.isNaN(startMs)) {
    return {
      state: 'idle',
      offsetMs: 0,
      loopIndex: 0,
      remainingToStartMs: null,
    };
  }

  if (nowMs < startMs) {
    return {
      state: 'scheduled',
      offsetMs: 0,
      loopIndex: 0,
      remainingToStartMs: startMs - nowMs,
    };
  }

  const elapsed = nowMs - startMs;
  const loopIndex = Math.floor(elapsed / durationMs);
  const offsetMs = elapsed % durationMs;
  return {
    state: 'running',
    offsetMs,
    loopIndex,
    remainingToStartMs: 0,
  };
};

const minutesLabel = (ms) => {
  if (ms == null) return '';
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
};

const TimerIcon = ({ className = 'h-5 w-5' } = {}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M10 2h4" />
    <path d="M12 14l3-3" />
    <circle cx="12" cy="14" r="8" />
  </svg>
);

const DEFAULT_DURATION_MINUTES = 60;

const LoopTimelineArea = ({
  canShare = false,
  state,
  markers,
  onSaveState,
  onAddMarker,
  onDeleteMarker,
}) => {
  const [now, setNow] = useState(() => new Date());
  const [startMode, setStartMode] = useState('sync'); // sync | now
  const [durationInput, setDurationInput] = useState('');
  const [delayInput, setDelayInput] = useState('0');

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [markerText, setMarkerText] = useState('');
  const [markerOffset, setMarkerOffset] = useState('0');

  const longPressTimerRef = useRef(null);

  const durationMinutes = useMemo(() => {
    const fromState = clampInt(state?.duration_minutes, { min: 1, max: 24 * 60, fallback: DEFAULT_DURATION_MINUTES });
    const fromInput = durationInput.trim() ? clampInt(durationInput, { min: 1, max: 24 * 60, fallback: fromState }) : fromState;
    return fromInput;
  }, [durationInput, state?.duration_minutes]);

  const startDelayMinutes = useMemo(() => {
    const fromState = clampInt(state?.start_delay_minutes, { min: 0, max: 24 * 60, fallback: 0 });
    const fromInput = delayInput.trim() ? clampInt(delayInput, { min: 0, max: 24 * 60, fallback: fromState }) : fromState;
    return fromInput;
  }, [delayInput, state?.start_delay_minutes]);

  const status = typeof state?.status === 'string' ? state.status : 'idle';
  const startAt = state?.start_at ?? null;

  const progress = useMemo(
    () => computeLoopProgress({ now, startAt, durationMinutes }),
    [now, startAt, durationMinutes]
  );

  const markerList = Array.isArray(markers) ? markers : [];

  useEffect(() => {
    const timerId = setInterval(() => setNow(new Date()), 250);
    return () => clearInterval(timerId);
  }, []);

  useEffect(() => {
    if (!state) {
      setDurationInput(String(DEFAULT_DURATION_MINUTES));
      setDelayInput('0');
      return;
    }
    if (!durationInput) {
      const next = clampInt(state?.duration_minutes, { min: 1, max: 24 * 60, fallback: DEFAULT_DURATION_MINUTES });
      setDurationInput(String(next));
    }
    if (!delayInput) {
      const next = clampInt(state?.start_delay_minutes, { min: 0, max: 24 * 60, fallback: 0 });
      setDelayInput(String(next));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handlePersistSettings = useCallback(() => {
    if (!onSaveState) return;
    onSaveState({
      duration_minutes: durationMinutes,
      start_delay_minutes: startDelayMinutes,
    });
  }, [durationMinutes, onSaveState, startDelayMinutes]);

  const computeAlignedStartAt = useCallback(() => {
    const base = new Date();
    base.setSeconds(0, 0);
    const delayed = new Date(base.getTime() + startDelayMinutes * 60_000);
    // 0分指定でも、過去にならないように次分へ寄せる
    if (delayed.getTime() <= Date.now()) {
      delayed.setMinutes(delayed.getMinutes() + 1);
      delayed.setSeconds(0, 0);
    }
    return delayed.toISOString();
  }, [startDelayMinutes]);

  const handleStart = useCallback(() => {
    if (!onSaveState) return;

    const nextStartAt =
      startMode === 'now'
        ? new Date().toISOString()
        : computeAlignedStartAt();

    onSaveState({
      duration_minutes: durationMinutes,
      start_delay_minutes: startDelayMinutes,
      start_at: nextStartAt,
      status: 'running',
    });
  }, [computeAlignedStartAt, durationMinutes, onSaveState, startDelayMinutes, startMode]);

  const handleStop = useCallback(() => {
    if (!onSaveState) return;
    onSaveState({
      status: 'stopped',
    });
  }, [onSaveState]);

  const handleEnd = useCallback(() => {
    if (!onSaveState) return;
    onSaveState({
      status: 'idle',
      start_at: null,
    });
  }, [onSaveState]);

  const handleStopPointerDown = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressTimerRef.current = setTimeout(() => {
      longPressTimerRef.current = null;
      handleEnd();
    }, 900);
  }, [handleEnd]);

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleAddSubmit = useCallback(
    (event) => {
      event.preventDefault();
      if (!onAddMarker) return;

      const text = String(markerText || '').trim();
      if (!text) return;

      const offsetMinutes = clampInt(markerOffset, { min: 0, max: durationMinutes, fallback: 0 });
      onAddMarker({
        text: text.slice(0, 16),
        offset_minutes: offsetMinutes,
      });

      setMarkerText('');
      setMarkerOffset('0');
      setIsAddOpen(false);
    },
    [durationMinutes, markerOffset, markerText, onAddMarker]
  );

  const lineHeightPx = 360;

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex size-9 items-center justify-center rounded-full bg-slate-100 text-slate-600">
              <TimerIcon className="h-5 w-5" />
            </div>
            <div className="flex flex-col">
              <div className="text-sm font-semibold text-slate-900">ループタイムライン</div>
              <div className="text-[11px] text-slate-500">
                {canShare ? 'リアルタイム共有' : '共有にはログインが必要です'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <span>長さ(分)</span>
              <input
                type="number"
                min={1}
                max={24 * 60}
                value={durationInput}
                onChange={(e) => setDurationInput(e.target.value)}
                className="w-20 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-indigo-300"
              />
            </label>
            <button
              type="button"
              className="rounded-md border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-600 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={handlePersistSettings}
              disabled={!canShare}
              title={canShare ? '設定を保存' : 'ログインすると保存できます'}
            >
              保存
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-full bg-slate-100 p-1">
            <button
              type="button"
              className={`h-8 rounded-full px-3 text-xs font-semibold transition ${
                startMode === 'sync' ? 'bg-white text-indigo-600 shadow' : 'text-slate-600'
              }`}
              onClick={() => setStartMode('sync')}
            >
              指定分(同期)
            </button>
            <button
              type="button"
              className={`h-8 rounded-full px-3 text-xs font-semibold transition ${
                startMode === 'now' ? 'bg-white text-indigo-600 shadow' : 'text-slate-600'
              }`}
              onClick={() => setStartMode('now')}
            >
              すぐ開始
            </button>
          </div>

          {startMode === 'sync' && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <span>開始まで(分)</span>
              <input
                type="number"
                min={0}
                max={24 * 60}
                value={delayInput}
                onChange={(e) => setDelayInput(e.target.value)}
                className="w-20 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-indigo-300"
              />
            </label>
          )}

          <button
            type="button"
            className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleStart}
            disabled={!canShare}
            title={canShare ? '' : 'ログインすると開始できます'}
          >
            開始
          </button>

          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={handleStop}
            onPointerDown={handleStopPointerDown}
            onPointerUp={clearLongPress}
            onPointerCancel={clearLongPress}
            onPointerLeave={clearLongPress}
            disabled={!canShare}
            title="クリックで停止 / 長押しで終了"
          >
            停止
          </button>

          <button
            type="button"
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={() => setIsAddOpen((v) => !v)}
            disabled={!canShare}
          >
            追加
          </button>

          <div className="ml-auto text-[11px] text-slate-500">
            <span className="mr-2">状態: {status}</span>
            {startAt && (
              <span>
                start: {formatClock(startAt)}
                {progress.state === 'scheduled' ? ` (開始まで ${minutesLabel(progress.remainingToStartMs)})` : ''}
              </span>
            )}
          </div>
        </div>

        {isAddOpen && (
          <form onSubmit={handleAddSubmit} className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <span>テキスト</span>
              <input
                type="text"
                value={markerText}
                onChange={(e) => setMarkerText(e.target.value)}
                maxLength={16}
                placeholder="10文字程度"
                className="w-44 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-indigo-300"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <span>何分後</span>
              <input
                type="number"
                min={0}
                max={durationMinutes}
                value={markerOffset}
                onChange={(e) => setMarkerOffset(e.target.value)}
                className="w-20 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-indigo-300"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-500"
            >
              追加する
            </button>
            <button
              type="button"
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={() => setIsAddOpen(false)}
            >
              キャンセル
            </button>
          </form>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden p-4">
        <div className="flex h-full min-h-0 gap-6 overflow-hidden">
          <div className="flex flex-col items-center">
            <div className="relative" style={{ height: `${lineHeightPx}px`, width: '44px' }}>
              <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300" aria-hidden="true" />
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 text-[11px] font-semibold text-slate-500">0</div>
              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 text-[11px] font-semibold text-slate-500">
                {durationMinutes}
              </div>

              {status === 'running' && progress.state === 'running' && (
                <div
                  className="absolute left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500"
                  style={{ top: `${(progress.offsetMs / (durationMinutes * 60_000)) * lineHeightPx}px` }}
                  title={`ループ ${progress.loopIndex + 1}`}
                />
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="text-xs font-semibold text-slate-600">追加項目</div>
            <div className="mt-2 custom-scrollbar h-[calc(100%-1.25rem)] overflow-y-auto pr-2">
              {markerList.length === 0 ? (
                <div className="text-sm text-slate-400">追加項目はありません</div>
              ) : (
                <div className="space-y-2">
                  {markerList.map((m) => {
                    const id = m?.id ?? null;
                    const text = typeof m?.text === 'string' ? m.text : '';
                    const offset = clampInt(m?.offset_minutes, { min: 0, max: durationMinutes, fallback: 0 });
                    const top = (offset / Math.max(1, durationMinutes)) * lineHeightPx;

                    return (
                      <div key={id ?? `${text}-${offset}`} className="relative rounded-lg border border-slate-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-slate-900">{text || '（無題）'}</div>
                            <div className="text-[11px] text-slate-500">{offset}分後</div>
                          </div>
                          <button
                            type="button"
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            onClick={() => id != null && onDeleteMarker && onDeleteMarker(id)}
                            disabled={!canShare || id == null}
                            title={id == null ? '同期前のデータです' : '削除'}
                          >
                            削除
                          </button>
                        </div>

                        <div className="pointer-events-none absolute right-full top-1/2 mr-4 hidden h-0 w-0 md:block" aria-hidden="true" />
                        <div
                          className="absolute -left-6 top-0 hidden md:block"
                          style={{ height: `${lineHeightPx}px` }}
                          aria-hidden="true"
                        >
                          <div
                            className="absolute left-1/2 w-px -translate-x-1/2 bg-transparent"
                            style={{ top: 0, bottom: 0 }}
                          />
                          <div
                            className="absolute left-1/2 h-0.5 w-6 -translate-x-1/2 bg-indigo-200"
                            style={{ top: `${top}px` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoopTimelineArea;
