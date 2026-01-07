import React, { useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle } from 'react';

const clampInt = (value, { min, max, fallback }) => {
  const n = Number.parseInt(String(value), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const formatMmSs = (ms) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const isRunning = (state) => String(state?.status || '').toLowerCase() === 'running';
const parsePausedElapsedMsFromStatus = (status) => {
  const raw = String(status || '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'paused') return 0;
  if (!raw.startsWith('paused:')) return null;
  const tail = raw.slice('paused:'.length);
  const n = Number.parseInt(tail, 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, n);
};
const parseStartAtMs = (value) => {
  if (!value) return null;
  const t = Date.parse(String(value));
  return Number.isNaN(t) ? null : t;
};

// 通知は workers（push）に一本化するため、ループ画面からのローカル通知は送らない。
// ループ通知（マーカー到達）は workers のcronが送信するpushに委ねる。
const showLoopAlert = () => {};

const DEFAULT_DURATION_MINUTES = 60;
const DEFAULT_START_MINUTE = 0;

const IconPlay = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M8 5v14l11-7z" />
  </svg>
);

const IconStop = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M6 6h12v12H6z" />
  </svg>
);

const LoopTimelineArea = React.forwardRef(({
  canShare = false,
  state,
  markers,
  onSaveState,
  onAddMarker,
  onUpdateMarker,
  onDeleteMarker,
}, ref) => {
  const cardRef = useRef(null);
  const scrollAreaRef = useRef(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const persistedDuration = state?.duration_minutes;
  const persistedDelay = state?.start_delay_minutes;

  const [durationMinutesInput, setDurationMinutesInput] = useState(() =>
    clampInt(persistedDuration ?? DEFAULT_DURATION_MINUTES, { min: 1, max: 24 * 60, fallback: DEFAULT_DURATION_MINUTES })
  );
  // NOTE: DBフィールドは start_delay_minutes のままですが、UI/挙動は「時計の分（0-59）」として扱います。
  const [delayMinutesInput, setDelayMinutesInput] = useState(() => {
    const v = clampInt(persistedDelay ?? DEFAULT_START_MINUTE, { min: 0, max: 59, fallback: DEFAULT_START_MINUTE });
    return String(v);
  });
  const [isMarkerModalOpen, setIsMarkerModalOpen] = useState(false);
  const [markerModalMode, setMarkerModalMode] = useState('create');
  const [editingMarkerId, setEditingMarkerId] = useState(null);
  const [modalText, setModalText] = useState('');
  const [modalMessage, setModalMessage] = useState('');
  const [modalOffsetInput, setModalOffsetInput] = useState('0');

  useEffect(() => {
    if (persistedDuration == null) return;
    setDurationMinutesInput((prev) => {
      // ユーザー入力中の急な上書きは避けつつ、極端にズレていたら同期。
      const next = clampInt(persistedDuration, { min: 1, max: 24 * 60, fallback: prev });
      return next;
    });
  }, [persistedDuration]);

  useEffect(() => {
    if (persistedDelay == null) return;
    const next = clampInt(persistedDelay, { min: 0, max: 59, fallback: DEFAULT_START_MINUTE });
    setDelayMinutesInput(String(next));
  }, [persistedDelay]);

  const durationMinutes = clampInt(durationMinutesInput, { min: 1, max: 24 * 60, fallback: DEFAULT_DURATION_MINUTES });
  const startMinute = useMemo(() => {
    // 0-59: 次にその「分」になったら開始（即開始は再生ダブルクリック）
    return clampInt(delayMinutesInput, { min: 0, max: 59, fallback: 0 });
  }, [delayMinutesInput]);
  const startAtMs = useMemo(() => parseStartAtMs(state?.start_at), [state?.start_at]);
  const running = isRunning(state);
  const pausedElapsedMs = useMemo(() => parsePausedElapsedMsFromStatus(state?.status), [state?.status]);
  const paused = pausedElapsedMs != null;
  const scheduled = running && startAtMs != null && startAtMs > nowMs;
  const countdownMs = scheduled && startAtMs != null ? startAtMs - nowMs : 0;
  const elapsedMsRaw = startAtMs == null ? null : nowMs - startAtMs;
  const runningElapsedMs = elapsedMsRaw == null ? null : Math.max(0, elapsedMsRaw);
  const effectiveElapsedMinutes = running
    ? ((runningElapsedMs ?? 0) / 60000)
    : (paused ? (pausedElapsedMs / 60000) : 0);
  const loopMinutes = durationMinutes > 0 ? (effectiveElapsedMinutes % durationMinutes) : 0;
  const progressRatio = durationMinutes > 0 ? loopMinutes / durationMinutes : 0;

  const canWrite = canShare && typeof onSaveState === 'function';

  const safeMarkers = useMemo(() => (Array.isArray(markers) ? markers : []), [markers]);

  const [isEditingDurationOnLine, setIsEditingDurationOnLine] = useState(false);
  const [durationInlineValue, setDurationInlineValue] = useState('');

  const openDurationInlineEdit = useCallback(() => {
    setDurationInlineValue(String(durationMinutes));
    setIsEditingDurationOnLine(true);
  }, [durationMinutes]);

  const closeDurationInlineEdit = useCallback(() => {
    setIsEditingDurationOnLine(false);
  }, []);

  const commitDurationInlineEdit = useCallback(() => {
    const next = clampInt(durationInlineValue, { min: 1, max: 24 * 60, fallback: durationMinutes });
    setDurationMinutesInput(String(next));
    setIsEditingDurationOnLine(false);

    if (!canWrite) return;
    if (next === durationMinutes) return;
    Promise.resolve(onSaveState({
      duration_minutes: next,
      start_delay_minutes: startMinute,
    })).catch(() => {});
  }, [canWrite, durationInlineValue, durationMinutes, onSaveState, startMinute]);

  const [isEditingStartMinuteOnBubble, setIsEditingStartMinuteOnBubble] = useState(false);
  const [startMinuteInlineValue, setStartMinuteInlineValue] = useState('');

  const openStartMinuteInlineEdit = useCallback(() => {
    setStartMinuteInlineValue(String(startMinute));
    setIsEditingStartMinuteOnBubble(true);
  }, [startMinute]);

  const closeStartMinuteInlineEdit = useCallback(() => {
    setIsEditingStartMinuteOnBubble(false);
  }, []);

  const commitStartMinuteInlineEdit = useCallback(() => {
    const next = clampInt(startMinuteInlineValue, { min: 0, max: 59, fallback: startMinute });
    setDelayMinutesInput(String(next));
    setIsEditingStartMinuteOnBubble(false);

    if (!canWrite) return;
    if (next === startMinute) return;
    Promise.resolve(onSaveState({
      duration_minutes: durationMinutes,
      start_delay_minutes: next,
    })).catch(() => {});
  }, [canWrite, durationMinutes, onSaveState, startMinute, startMinuteInlineValue]);

  const lineContainerRef = useRef(null);

  // NOTE:
  // スクロール領域(可視ウィンドウ)の高さに追従して縦線を伸縮させる。
  const [scrollViewportHeightPx, setScrollViewportHeightPx] = useState(0);
  const [scrollViewportWidthPx, setScrollViewportWidthPx] = useState(0);
  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return undefined;
    const update = () => {
      const h = Math.max(0, Math.floor(el.clientHeight || 0));
      const w = Math.max(0, Math.floor(el.clientWidth || 0));
      setScrollViewportHeightPx((prev) => (prev === h ? prev : h));
      setScrollViewportWidthPx((prev) => (prev === w ? prev : w));
    };
    update();
    const ro = new ResizeObserver(() => {
      window.requestAnimationFrame(update);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const lineTopPadPx = 18;
  const lineBottomPadPx = 22;

  // マーカーラベルの被り回避:
  // - 点(本来位置)は baseY のまま
  // - ラベルは縦にズラさず、近いものだけ横方向の「レーン」に逃がす
  // - 点とラベルは常に細い横線で接続する
  const markerLabelHeightPx = 26;
  const markerLabelHalfPx = Math.floor(markerLabelHeightPx / 2);
  const markerLabelGapPx = 6;
  // 横方向の配置パラメータ
  const markerConnectorBasePx = 16;
  const markerLabelXGapPx = 8;
  const markerLabelMaxWidthPx = 112; // max-w-28 相当
  const markerLabelMinWidthPx = 48;

  const baseLineBoxHeightPx = useMemo(() => {
    // 可能な限りスクロールバーを出さないため、基本は可視ウィンドウの高さに合わせる。
    // ※スクロールを出さない要求のため、ここで高さを増やさない。
    return Math.max(160, scrollViewportHeightPx);
  }, [scrollViewportHeightPx]);

  // 右側にラベルを出すための利用可能幅（スクロール禁止のため、この範囲で詰めて配置する）
  const availableRightPx = useMemo(() => {
    const lineCenterX = 48; // w-24 の中央
    const rightPadding = 12;
    const w = Math.max(0, scrollViewportWidthPx);
    return Math.max(0, Math.floor(w - lineCenterX - rightPadding));
  }, [scrollViewportWidthPx]);

  const computeMarkerLayout = useCallback((lineBoxHeightPx) => {
    const usable = Math.max(1, lineBoxHeightPx - lineTopPadPx - lineBottomPadPx);
    return {
      dotY: Math.round(lineTopPadPx + progressRatio * usable),
      markers: [],
    };
  }, [lineBottomPadPx, lineTopPadPx, progressRatio]);

  const computePackedMarkerLayout = useCallback((lineBoxHeightPx) => {
    const base = computeMarkerLayout(lineBoxHeightPx);
    // computeMarkerLayout は markers を空にしているため、ここで items を再構築
    const usable = Math.max(1, lineBoxHeightPx - lineTopPadPx - lineBottomPadPx);
    const loopNow = running ? loopMinutes : null;

    // 直近(次)のマーカー（未終了）を算出（z-index用）
    let nextKey = null;
    if (loopNow != null && durationMinutes > 0) {
      let bestDelta = Infinity;
      for (const m of safeMarkers) {
        const text = String(m?.text ?? '').trim();
        if (!text) continue;
        const offset = clampInt(m?.offset_minutes ?? 0, { min: 0, max: durationMinutes, fallback: 0 });
        const rawDelta = offset - loopNow;
        const delta = rawDelta > 0 ? rawDelta : (rawDelta + durationMinutes);
        if (delta <= 0) continue;
        const key = m?.id ?? `${text}:${offset}`;
        if (delta < bestDelta) {
          bestDelta = delta;
          nextKey = key;
        }
      }
    }

    const items = safeMarkers
      .map((m) => {
        const text = String(m?.text ?? '').trim();
        if (!text) return null;
        const offset = clampInt(m?.offset_minutes ?? 0, { min: 0, max: durationMinutes, fallback: 0 });
        const key = m?.id ?? `${text}:${offset}`;
        const baseY = Math.round(lineTopPadPx + (durationMinutes > 0 ? (offset / durationMinutes) * usable : 0));

        let isAlerted = false;
        let isUpcoming = false;
        if (loopNow != null && durationMinutes > 0) {
          const epsilon = 0.01;
          isAlerted = offset <= (loopNow + epsilon);
          isUpcoming = !isAlerted;
        }

        const zIndex = (nextKey != null && key === nextKey)
          ? 30
          : (isUpcoming ? 20 : 10);

        return { key, marker: m, text, offset, baseY, zIndex };
      })
      .filter(Boolean)
      .sort((a, b) => a.baseY - b.baseY);

    // 縦方向で重なるものをクラスター化して、同一Yのまま横に詰めて配置
    const clusters = [];
    let current = null;
    for (const it of items) {
      const startY = it.baseY - markerLabelHalfPx;
      const endY = it.baseY + markerLabelHalfPx;
      if (!current) {
        current = { startY, endY, items: [it] };
        continue;
      }
      if (startY <= current.endY + markerLabelGapPx) {
        current.endY = Math.max(current.endY, endY);
        current.items.push(it);
      } else {
        clusters.push(current);
        current = { startY, endY, items: [it] };
      }
    }
    if (current) clusters.push(current);

    const laidOut = [];
    for (const c of clusters) {
      const n = c.items.length;
      const gapTotal = markerLabelXGapPx * Math.max(0, n - 1);
      const usableRight = Math.max(0, availableRightPx - markerConnectorBasePx - gapTotal);
      const slotW = Math.max(
        markerLabelMinWidthPx,
        Math.min(markerLabelMaxWidthPx, Math.floor((usableRight || 0) / Math.max(1, n)))
      );

      for (let i = 0; i < n; i += 1) {
        const it = c.items[i];
        // ラベルが必ず収まるように、横線(=開始位置)を計算
        const maxStart = Math.max(0, availableRightPx - slotW);
        const start = Math.min(
          maxStart,
          markerConnectorBasePx + i * (slotW + markerLabelXGapPx)
        );
        laidOut.push({ ...it, connectorWidthPx: Math.max(8, Math.floor(start)), labelMaxWidthPx: slotW });
      }
    }

    return { dotY: base.dotY, markers: laidOut };
  }, [
    availableRightPx,
    computeMarkerLayout,
    durationMinutes,
    lineBottomPadPx,
    lineTopPadPx,
    loopMinutes,
    markerConnectorBasePx,
    markerLabelGapPx,
    markerLabelHalfPx,
    markerLabelMaxWidthPx,
    markerLabelMinWidthPx,
    markerLabelXGapPx,
    running,
    safeMarkers,
  ]);

  const { lineBoxHeightPx, dotY, markerLayout } = useMemo(() => {
    // スクロール禁止: 高さは可視ウィンドウ固定。
    const targetH = baseLineBoxHeightPx;
    const layout = computePackedMarkerLayout(targetH);
    return {
      lineBoxHeightPx: targetH,
      dotY: layout.dotY,
      markerLayout: layout.markers,
    };
  }, [baseLineBoxHeightPx, computePackedMarkerLayout]);

  const [countdownOverlayPos, setCountdownOverlayPos] = useState(null);
  const updateCountdownOverlayPos = useCallback(() => {
    const cardEl = cardRef.current;
    const lineEl = lineContainerRef.current;
    if (!cardEl || !lineEl) return;
    const cardRect = cardEl.getBoundingClientRect();
    const lineRect = lineEl.getBoundingClientRect();
    const top = Math.round((lineRect.top - cardRect.top) + dotY);
    const left = Math.floor((lineRect.left - cardRect.left) + (lineRect.width / 2.03));
    setCountdownOverlayPos({ top, left });
  }, [dotY]);

  useEffect(() => {
    if (!scheduled) {
      setCountdownOverlayPos(null);
      return;
    }

    updateCountdownOverlayPos();
    const scrollEl = scrollAreaRef.current;

    const onScroll = () => updateCountdownOverlayPos();
    const onResize = () => updateCountdownOverlayPos();

    if (scrollEl) {
      scrollEl.addEventListener('scroll', onScroll, { passive: true });
    }
    window.addEventListener('resize', onResize);

    return () => {
      if (scrollEl) {
        scrollEl.removeEventListener('scroll', onScroll);
      }
      window.removeEventListener('resize', onResize);
    };
  }, [scheduled, updateCountdownOverlayPos]);

  const handleStart = useCallback(async ({ forceImmediate = false } = {}) => {
    if (!canWrite) return;

    // paused の場合は、保存されている経過msから復帰（開始分は無視して即時）
    if (paused) {
      const resumedStartAt = new Date(Date.now() - pausedElapsedMs).toISOString();
      await onSaveState({
        duration_minutes: durationMinutes,
        start_delay_minutes: startMinute,
        start_at: resumedStartAt,
        status: 'running',
      });
      return;
    }

    const startAtDate = new Date();
    const shouldStartNow = forceImmediate;

    if (shouldStartNow) {
      // すぐ開始
      // start_at は「今」を入れて他端末と同期
    } else {
      // 次の「startMinute分ちょうど」に開始
      startAtDate.setSeconds(0, 0);
      startAtDate.setMinutes(startMinute);
      if (startAtDate.getTime() <= Date.now()) {
        startAtDate.setHours(startAtDate.getHours() + 1);
      }
    }

    const startAt = (shouldStartNow ? new Date() : startAtDate).toISOString();
    await onSaveState({
      duration_minutes: durationMinutes,
      // 互換のためフィールド名は維持（値は「開始する分」）
      start_delay_minutes: startMinute,
      start_at: startAt,
      status: 'running',
    });
  }, [canWrite, durationMinutes, onSaveState, paused, pausedElapsedMs, startMinute]);

  const lastNotifiedCycleByMarkerKeyRef = useRef(new Map());
  const prevLoopProgressRef = useRef({ durationMinutes: null, cycle: null, loopMinutes: null });
  const lastSeenStartAtMsRef = useRef(null);

  const resetLoopNotificationState = useCallback(() => {
    lastNotifiedCycleByMarkerKeyRef.current.clear();
    prevLoopProgressRef.current = { durationMinutes: durationMinutes, cycle: null, loopMinutes: null };
  }, [durationMinutes]);

  useEffect(() => {
    // 停止/一時停止/開始前カウントダウン中は通知監視をリセット。
    if (!running || paused || scheduled) {
      resetLoopNotificationState();
    }
  }, [paused, resetLoopNotificationState, running, scheduled]);

  useEffect(() => {
    if (!running) return;
    if (paused) return;
    if (scheduled) return;
    if (durationMinutes <= 0) return;
    if (startAtMs == null) return;

    // タブ再訪（初回マウント）で start_at が過去の場合、0分マーカーを即時発火させない。
    // 「開始した直後」の場合のみ 0分マーカーを拾う。
    const startAtChanged = lastSeenStartAtMsRef.current !== startAtMs;
    if (startAtChanged) {
      lastSeenStartAtMsRef.current = startAtMs;
      resetLoopNotificationState();
    }

    const durationMs = durationMinutes * 60 * 1000;
    const elapsedMs = Math.max(0, nowMs - startAtMs);
    const cycle = durationMs > 0 ? Math.floor(elapsedMs / durationMs) : 0;
    const loopMinutesNow = durationMs > 0 ? ((elapsedMs % durationMs) / 60000) : 0;

    const prev = prevLoopProgressRef.current;
    if (prev.durationMinutes !== durationMinutes) {
      resetLoopNotificationState();
    }

    const nextPrev = prevLoopProgressRef.current;
    const markerItems = safeMarkers
      .map((m) => {
        const text = String(m?.text ?? '').trim();
        const offset = clampInt(m?.offset_minutes ?? 0, { min: 0, max: durationMinutes, fallback: 0 });
        const key = m?.id ?? `${text}:${offset}`;
        return { key, text, offset };
      })
      .filter((m) => Boolean(m.text));

    const fireIfNeeded = (marker, targetCycle) => {
      const lastCycle = lastNotifiedCycleByMarkerKeyRef.current.get(marker.key);
      if (lastCycle === targetCycle) return;
      lastNotifiedCycleByMarkerKeyRef.current.set(marker.key, targetCycle);
      showLoopAlert(marker.text);
    };

    // 初回tick: 開始直後(短時間)のときだけ 0分マーカーを拾う。
    // そうでない場合（ループ実行中に「ループ」タブを開いた等）は、状態同期のみ行う。
    if (nextPrev.cycle == null || nextPrev.loopMinutes == null) {
      const startAgeMs = Math.max(0, nowMs - startAtMs);
      const shouldFireZeroOffset = startAgeMs <= 1500; // 250ms tick + 実行環境の揺れを吸収

      if (shouldFireZeroOffset) {
        for (const marker of markerItems) {
          if (marker.offset === 0) {
            fireIfNeeded(marker, cycle);
          }
        }
      }
      prevLoopProgressRef.current = { durationMinutes, cycle, loopMinutes: loopMinutesNow };
      return;
    }

    const prevCycle = nextPrev.cycle;
    const prevLoopMinutes = nextPrev.loopMinutes;

    if (cycle === prevCycle) {
      if (loopMinutesNow >= prevLoopMinutes) {
        for (const marker of markerItems) {
          if (marker.offset > prevLoopMinutes && marker.offset <= loopMinutesNow) {
            fireIfNeeded(marker, cycle);
          }
        }
      }
    } else if (cycle === prevCycle + 1) {
      // 1周跨いだ（wrap）
      for (const marker of markerItems) {
        if (marker.offset > prevLoopMinutes && marker.offset <= durationMinutes) {
          fireIfNeeded(marker, prevCycle);
        }
      }
      for (const marker of markerItems) {
        if (marker.offset >= 0 && marker.offset <= loopMinutesNow) {
          fireIfNeeded(marker, cycle);
        }
      }
    } else {
      // 大きく飛んだ（タブが長時間止まっていた等）: 連打を避けるため通知せずに同期だけ。
    }

    prevLoopProgressRef.current = { durationMinutes, cycle, loopMinutes: loopMinutesNow };
  }, [durationMinutes, nowMs, paused, resetLoopNotificationState, running, safeMarkers, scheduled, startAtMs]);

  const playClickTimerRef = useRef(null);
  const clearPlayClickTimer = useCallback(() => {
    if (playClickTimerRef.current) {
      window.clearTimeout(playClickTimerRef.current);
      playClickTimerRef.current = null;
    }
  }, []);

  const handlePlayClick = useCallback(() => {
    if (!canWrite) return;
    clearPlayClickTimer();
    playClickTimerRef.current = window.setTimeout(() => {
      playClickTimerRef.current = null;
      handleStart({ forceImmediate: false }).catch(() => {});
    }, 250);
  }, [canWrite, clearPlayClickTimer, handleStart]);

  const handlePlayDoubleClick = useCallback(() => {
    if (!canWrite) return;
    clearPlayClickTimer();
    handleStart({ forceImmediate: true }).catch(() => {});
  }, [canWrite, clearPlayClickTimer, handleStart]);

  const stopClickTimerRef = useRef(null);
  const clearStopClickTimer = useCallback(() => {
    if (stopClickTimerRef.current) {
      window.clearTimeout(stopClickTimerRef.current);
      stopClickTimerRef.current = null;
    }
  }, []);

  const doPause = useCallback(async () => {
    if (!canWrite) return;
    if (!running) return;

    const elapsedMs = startAtMs == null ? 0 : Math.max(0, Date.now() - startAtMs);
    await onSaveState({
      status: `paused:${Math.round(elapsedMs)}`,
    });
  }, [canWrite, onSaveState, running, startAtMs]);

  const doClear = useCallback(async () => {
    if (!canWrite) return;
    await onSaveState({
      status: 'idle',
      start_at: null,
    });
  }, [canWrite, onSaveState]);

  const handleStopClick = useCallback(() => {
    if (!canWrite) return;
    clearStopClickTimer();
    stopClickTimerRef.current = window.setTimeout(() => {
      stopClickTimerRef.current = null;
      doPause().catch(() => {});
    }, 250);
  }, [canWrite, clearStopClickTimer, doPause]);

  const handleStopDoubleClick = useCallback(() => {
    if (!canWrite) return;
    clearStopClickTimer();
    doClear().catch(() => {});
  }, [canWrite, clearStopClickTimer, doClear]);
  useEffect(() => () => clearPlayClickTimer(), [clearPlayClickTimer]);
  useEffect(() => () => clearStopClickTimer(), [clearStopClickTimer]);

  const openCreateMarkerModal = useCallback(() => {
    setMarkerModalMode('create');
    setEditingMarkerId(null);
    setModalText('');
    setModalMessage('');
    setModalOffsetInput('0');
    setIsMarkerModalOpen(true);
  }, []);

  useImperativeHandle(ref, () => ({
    openCreate: openCreateMarkerModal,
  }), [openCreateMarkerModal]);

  const openEditMarkerModal = useCallback((marker) => {
    if (!marker) return;
    setMarkerModalMode('edit');
    setEditingMarkerId(marker?.id ?? null);
    setModalText(String(marker?.text ?? ''));
    setModalMessage(String(marker?.message ?? ''));
    setModalOffsetInput(String(marker?.offset_minutes ?? 0));
    setIsMarkerModalOpen(true);
  }, []);

  const closeMarkerModal = useCallback(() => {
    setIsMarkerModalOpen(false);
  }, []);

  const handleSubmitMarkerModal = useCallback(async () => {
    if (!canShare) return;
    const text = String(modalText || '').trim();
    if (!text) return;
    const message = String(modalMessage || '').trim();
    const offsetMinutes = clampInt(modalOffsetInput, { min: 0, max: durationMinutes, fallback: 0 });

    if (markerModalMode === 'edit') {
      if (typeof onUpdateMarker !== 'function' || editingMarkerId == null) return;
      await onUpdateMarker({ id: editingMarkerId, text, message, offset_minutes: offsetMinutes });
      closeMarkerModal();
      return;
    }

    if (typeof onAddMarker !== 'function') return;
    await onAddMarker({ text, message, offset_minutes: offsetMinutes });
    closeMarkerModal();
  }, [canShare, closeMarkerModal, durationMinutes, editingMarkerId, markerModalMode, modalMessage, modalOffsetInput, modalText, onAddMarker, onUpdateMarker]);

  const handleDeleteMarkerModal = useCallback(async () => {
    if (!canShare) return;
    if (markerModalMode !== 'edit') return;
    if (typeof onDeleteMarker !== 'function' || editingMarkerId == null) return;
    await onDeleteMarker(editingMarkerId);
    closeMarkerModal();
  }, [canShare, closeMarkerModal, editingMarkerId, markerModalMode, onDeleteMarker]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="flex-1 min-h-0 overflow-hidden p-3">
        <div ref={cardRef} className="relative flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white p-3">
          <div className="relative z-10 flex items-center justify-end">
            <div className="flex items-center gap-2">
              <div className="relative">
                <div
                  className="absolute right-full top-1/2 mr-2 -translate-y-1/2"
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    openStartMinuteInlineEdit();
                  }}
                >
                  {isEditingStartMinuteOnBubble ? (
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={startMinuteInlineValue}
                      onChange={(e) => setStartMinuteInlineValue(e.target.value)}
                      onBlur={commitStartMinuteInlineEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitStartMinuteInlineEdit();
                        if (e.key === 'Escape') closeStartMinuteInlineEdit();
                      }}
                      className="no-spinner w-12 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-center text-[11px] font-semibold text-slate-900 outline-none focus:border-indigo-400"
                      inputMode="numeric"
                      autoFocus
                    />
                  ) : (
                    <div className="relative cursor-pointer select-none rounded-full bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                      {startMinute}
                      <span
                        className="absolute left-full -ml-px top-1/2 h-0 w-0 -translate-y-1/2 border-y-4 border-l-4 border-y-transparent border-l-slate-900"
                        aria-hidden="true"
                      />
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className={`inline-flex h-9 w-9 items-center justify-center !rounded-full !p-0 !text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    running
                      ? '!bg-rose-600 hover:!bg-rose-700'
                      : '!bg-indigo-600 hover:!bg-indigo-700'
                  }`}
                  onClick={handlePlayClick}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    handlePlayDoubleClick();
                  }}
                  disabled={!canWrite || running}
                  aria-label="再生"
                >
                  <IconPlay className="h-5 w-5" />
                </button>
              </div>

              <button
                type="button"
                className="relative inline-flex h-9 w-9 items-center justify-center !rounded-full !p-0 border !border-slate-300 !bg-white !text-slate-700 transition-colors hover:!bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleStopClick}
                onDoubleClick={(e) => {
                  e.preventDefault();
                  handleStopDoubleClick();
                }}
                disabled={!canWrite || (!running && !paused)}
                aria-label="停止"
              >
                <IconStop className="h-5 w-5" />
              </button>

            </div>
          </div>

          {scheduled && countdownOverlayPos && (
            <div
              className="pointer-events-none absolute z-20 h-0 w-0"
              style={{ top: `${countdownOverlayPos.top}px`, left: `${countdownOverlayPos.left}px` }}
            >
              <div className="absolute bottom-full left-0 mb-4 -translate-x-1/2">
                <div className="relative min-w-[52px] select-none rounded-full bg-slate-900 px-2 py-0.5 text-center text-[11px] font-semibold tabular-nums text-white">
                  {formatMmSs(countdownMs)}
                  <span
                    className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-slate-900"
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>
          )}

            <div ref={scrollAreaRef} className="mt-3 flex-1 min-h-0 overflow-hidden">
            <div className="flex min-h-full gap-4">
              <div
                ref={lineContainerRef}
                className="relative w-24 flex-shrink-0 min-h-full"
                  style={{ height: `${lineBoxHeightPx}px` }}
              >
              <div
                className="absolute left-1/2 w-1 -translate-x-1/2 rounded bg-slate-200"
                style={{ top: `${lineTopPadPx}px`, bottom: `${lineBottomPadPx}px` }}
              />


              <div
                className="absolute left-1/2 -translate-x-1/2"
                style={{ bottom: `${lineBottomPadPx - 6}px` }}
                title="ダブルクリックで変更"
                onDoubleClick={openDurationInlineEdit}
              >
                {isEditingDurationOnLine ? (
                  <input
                    type="number"
                    min={1}
                    max={24 * 60}
                    value={durationInlineValue}
                    onChange={(e) => setDurationInlineValue(e.target.value)}
                    onBlur={commitDurationInlineEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitDurationInlineEdit();
                      if (e.key === 'Escape') closeDurationInlineEdit();
                    }}
                    className="no-spinner w-14 rounded border border-slate-300 bg-white px-1 py-0.5 text-center text-[11px] font-semibold text-slate-900 outline-none focus:border-indigo-400"
                    inputMode="numeric"
                    autoFocus
                  />
                ) : (
                  <div className="cursor-pointer select-none rounded border border-slate-200 bg-white px-1 py-0.5 text-[11px] font-semibold leading-none text-slate-700">
                    {durationMinutes}
                  </div>
                )}
              </div>

              <div
                className={`absolute left-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white ${
                  running ? 'border-rose-600' : 'border-indigo-600'
                }`}
                style={{ top: `${dotY}px` }}
                title={running ? `現在: ${Math.floor(loopMinutes)}分` : '停止中'}
              />

                {markerLayout.map((it) => {
                  const m = it.marker;
                  const offset = it.offset;
                  const baseY = it.baseY;
                  const key = it.key;
                  const connectorWidthPx = it.connectorWidthPx;

                  return (
                    <React.Fragment key={key}>
                      {/* 本来位置の点 */}
                      <div
                        className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                        style={{ top: `${baseY}px`, zIndex: it.zIndex + 2 }}
                        title={`${offset}分: ${String(m?.text ?? '')}`}
                        onDoubleClick={() => openEditMarkerModal(m)}
                      >
                        <div className="h-2 w-2 rounded-full bg-slate-500" aria-hidden="true" />
                      </div>

                      {/* ラベル（縦は固定、近いものは横レーンに逃がす。常に横線で接続） */}
                      <div
                        className="absolute left-1/2 -translate-y-1/2 cursor-pointer select-none"
                        style={{ top: `${baseY}px`, zIndex: it.zIndex + 1 }}
                        title={`${offset}分: ${String(m?.text ?? '')}`}
                        onDoubleClick={() => openEditMarkerModal(m)}
                      >
                        <div className="flex items-center">
                          <div
                            className="relative top-[0.25px] h-px bg-slate-500"
                            style={{ width: `${connectorWidthPx}px` }}
                            aria-hidden="true"
                          />
                          <div
                            className="ml-1 truncate rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-800"
                            style={{ maxWidth: `${it.labelMaxWidthPx ?? 112}px` }}
                          >
                            {String(m?.text ?? '')}
                          </div>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>

              <div className="min-w-0 flex-1" />
            </div>
          </div>
        </div>

        {isMarkerModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                closeMarkerModal();
              }
            }}
          >
            <div className="w-full max-w-sm rounded-xl bg-white p-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-900">
                  {markerModalMode === 'edit' ? '編集' : '追加'}
                </div>
                <button
                  type="button"
                  className="inline-flex h-8 w-8 items-center justify-center !rounded-full !p-0 border border-slate-200 !bg-white !text-slate-700 hover:!bg-slate-50"
                  onClick={closeMarkerModal}
                  aria-label="閉じる"
                  title="閉じる"
                >
                  ×
                </button>
              </div>

              <div className="mt-3 space-y-3">
                <label className="block">
                  <div className="text-[11px] font-semibold text-slate-700">テキスト（10文字）</div>
                  <input
                    type="text"
                    maxLength={10}
                    value={modalText}
                    onChange={(e) => setModalText(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400"
                    placeholder="例: 休憩"
                    autoFocus
                  />
                </label>

                <label className="block">
                  <div className="text-[11px] font-semibold text-slate-700">メッセージ（任意 / 通知の本文）</div>
                  <textarea
                    rows={2}
                    maxLength={80}
                    value={modalMessage}
                    onChange={(e) => setModalMessage(e.target.value)}
                    className="mt-1 w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400"
                    placeholder="例: 水を飲む"
                  />
                </label>

                <label className="block">
                  <div className="text-[11px] font-semibold text-slate-700">位置（分）</div>
                  <input
                    type="number"
                    min={0}
                    max={durationMinutes}
                    value={modalOffsetInput}
                    onChange={(e) => setModalOffsetInput(e.target.value)}
                    className="no-spinner mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400"
                    inputMode="numeric"
                  />
                </label>
              </div>

              <div className="mt-4 flex items-center justify-end gap-2">
                {markerModalMode === 'edit' && (
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleDeleteMarkerModal}
                    aria-label="削除"
                    title="削除"
                    disabled={!canShare || typeof onDeleteMarker !== 'function' || editingMarkerId == null}
                  >
                    削除
                  </button>
                )}

                <button
                  type="button"
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleSubmitMarkerModal}
                  aria-label={markerModalMode === 'edit' ? '保存' : '追加'}
                  title={markerModalMode === 'edit' ? '保存' : '追加'}
                  disabled={!canShare || !String(modalText || '').trim() || (markerModalMode === 'edit' ? typeof onUpdateMarker !== 'function' : typeof onAddMarker !== 'function')}
                >
                  {markerModalMode === 'edit' ? '保存' : '追加'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default LoopTimelineArea;
