import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_DOUBLE_TAP_MS = 300;
const DEFAULT_TAP_SLOP_PX = 12;

const isCoarsePointerDevice = () => {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
};

/**
 * 画面左下/右下のダブルタップで開く、縦並びのフローティングメニュー。
 * - モバイル限定用途: enabled && coarse pointer の場合のみ動作
 * - items は将来増やす前提（設定ショートカット等）
 */
export default function CornerFloatingMenu({ enabled = false, items = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [corner, setCorner] = useState('right'); // 'left' | 'right'

  const canRender = useMemo(() => {
    if (!enabled) return false;
    if (!Array.isArray(items) || items.length === 0) return false;
    return isCoarsePointerDevice();
  }, [enabled, items]);

  const lastTapRef = useRef({
    ts: 0,
    x: 0,
    y: 0,
    corner: null,
  });

  useEffect(() => {
    if (!canRender) {
      setIsOpen(false);
    }
  }, [canRender]);

  const close = useCallback(() => setIsOpen(false), []);

  const tryOpenByDoubleTap = useCallback((event, nextCorner) => {
    const touch = event?.touches?.[0] || event?.changedTouches?.[0];
    if (!touch) return;

    const now = Date.now();
    const x = touch.clientX;
    const y = touch.clientY;

    const last = lastTapRef.current;
    const dt = now - last.ts;
    const dx = Math.abs(x - last.x);
    const dy = Math.abs(y - last.y);

    const isDoubleTap =
      last.corner === nextCorner &&
      dt > 0 &&
      dt <= DEFAULT_DOUBLE_TAP_MS &&
      dx <= DEFAULT_TAP_SLOP_PX &&
      dy <= DEFAULT_TAP_SLOP_PX;

    lastTapRef.current = { ts: now, x, y, corner: nextCorner };

    if (!isDoubleTap) return;

    // iOS Safari のダブルタップズームを抑止
    event.preventDefault();

    setCorner(nextCorner);
    setIsOpen((prev) => {
      // 同じ角で開いているなら閉じる（トグル）
      if (prev && corner === nextCorner) return false;
      return true;
    });
  }, [corner]);

  const handleItemClick = useCallback((item) => {
    if (!item || item.disabled) return;
    if (typeof item.onClick === 'function') {
      item.onClick();
    }
    setIsOpen(false);
  }, []);

  if (!canRender) return null;

  const menuPosClass =
    corner === 'left'
      ? 'left-3'
      : 'right-3';

  return (
    <>
      {/* 角のダブルタップ検出エリア（極小・透明） */}
      <div
        className="fixed bottom-0 left-0 z-[60] h-14 w-14 touch-manipulation"
        onTouchStart={(e) => tryOpenByDoubleTap(e, 'left')}
        aria-hidden="true"
      />
      <div
        className="fixed bottom-0 right-0 z-[60] h-14 w-14 touch-manipulation"
        onTouchStart={(e) => tryOpenByDoubleTap(e, 'right')}
        aria-hidden="true"
      />

      {isOpen && (
        <>
          {/* 外側タップで閉じる */}
          <button
            type="button"
            className="fixed inset-0 z-[70] cursor-default"
            onClick={close}
            aria-label="メニューを閉じる"
          />

          <div className={`fixed bottom-3 ${menuPosClass} z-[80]`}>
            <div className="flex flex-col gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl">
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border text-gray-600 transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
                    item.disabled
                      ? 'cursor-not-allowed border-gray-200 bg-white opacity-40'
                      : 'border-gray-200 bg-white hover:bg-indigo-50'
                  }`}
                  onClick={() => handleItemClick(item)}
                  disabled={item.disabled}
                  title={item.label}
                  aria-label={item.label}
                >
                  {item.icon}
                  <span className="sr-only">{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
