import React, { useEffect, useId, useRef } from 'react';

const ConfirmDialog = ({
  open,
  title = '確認',
  message = '',
  confirmText = 'OK',
  cancelText = 'キャンセル',
  variant = 'default',
  onConfirm,
  onCancel,
  closeOnBackdrop = true,
  closeOnEsc = true,
  confirmDisabled = false,
}) => {
  const titleId = useId();
  const messageId = useId();
  const cancelButtonRef = useRef(null);
  const lastActiveElementRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    lastActiveElementRef.current = document.activeElement;

    const t = window.setTimeout(() => {
      cancelButtonRef.current?.focus?.();
    }, 0);

    return () => {
      window.clearTimeout(t);
      const el = lastActiveElementRef.current;
      if (el && typeof el.focus === 'function') {
        try {
          el.focus();
        } catch {
          // noop
        }
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!closeOnEsc) return;

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (typeof onCancel === 'function') onCancel();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeOnEsc, onCancel, open]);

  if (!open) return null;

  const confirmButtonClass =
    variant === 'danger'
      ? 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-300'
      : 'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-300';

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onMouseDown={(event) => {
        if (!closeOnBackdrop) return;
        if (event.target !== event.currentTarget) return;
        if (typeof onCancel === 'function') onCancel();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-4 shadow-xl"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <div className="mb-2">
          <h2 id={titleId} className="text-base font-semibold text-gray-900">
            {title}
          </h2>
        </div>
        <div id={messageId} className="text-sm text-gray-700 whitespace-pre-wrap">
          {message}
        </div>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={() => {
              if (typeof onCancel === 'function') onCancel();
            }}
            className="inline-flex h-9 items-center justify-center rounded-full border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
          >
            {cancelText}
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={() => {
              if (confirmDisabled) return;
              if (typeof onConfirm === 'function') onConfirm();
            }}
            className={`inline-flex h-9 items-center justify-center rounded-full px-4 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
              confirmDisabled ? 'cursor-not-allowed opacity-50' : ''
            } ${confirmButtonClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
