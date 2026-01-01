import React, { useEffect, useRef } from 'react';

const formatUpdatedDateTime = (value) => {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const NoteModal = ({ isOpen, note, onClose, onUpdate }) => {
  const titleRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (onClose) onClose();
      }
    };

    const preventAllScroll = (e) => {
      const isInModal = e.target.closest('.note-modal-content');
      if (!isInModal) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleEsc);
    document.addEventListener('wheel', preventAllScroll, { passive: false, capture: true });
    document.addEventListener('touchmove', preventAllScroll, { passive: false, capture: true });

    return () => {
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleEsc);
      document.removeEventListener('wheel', preventAllScroll, { capture: true });
      document.removeEventListener('touchmove', preventAllScroll, { capture: true });
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    // 開いた瞬間にタイトルへフォーカス（入力しやすく）
    setTimeout(() => {
      titleRef.current?.focus();
    }, 0);
  }, [isOpen]);

  if (!isOpen) return null;

  const title = typeof note?.title === 'string' ? note.title : '';
  const content = typeof note?.content === 'string' ? note.content : '';
  const updatedLabel = formatUpdatedDateTime(note?.updated_at);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        // 背景クリックで閉じる
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
    >
      <div className="note-modal-content flex w-full max-w-[980px] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 p-4">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-gray-800 truncate">
              {title.trim() ? title : '無題のノート'}
            </div>
            {updatedLabel && (
              <div className="text-xs text-gray-500">{`更新: ${updatedLabel}`}</div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onClose && onClose()}
            className="text-gray-500 hover:text-gray-800 p-2 rounded-full hover:bg-gray-100 bg-white border border-gray-200 transition-colors duration-200"
            aria-label="閉じる"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <div className="p-4 space-y-3">
            <div>
              <label className="block text-gray-700 font-medium mb-2">タイトル</label>
              <input
                ref={titleRef}
                type="text"
                value={title}
                placeholder="タイトル"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                onChange={(e) => {
                  if (onUpdate && note?.id != null) {
                    onUpdate(note.id, { title: e.target.value });
                  }
                }}
              />
            </div>

            <div>
              <label className="block text-gray-700 font-medium mb-2">本文</label>
              <textarea
                value={content}
                placeholder="本文"
                className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition resize-none"
                style={{ minHeight: '55vh' }}
                onChange={(e) => {
                  if (onUpdate && note?.id != null) {
                    onUpdate(note.id, { content: e.target.value });
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default NoteModal;
