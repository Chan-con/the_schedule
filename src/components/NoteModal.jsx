import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildNoteShareUrl, parseNoteIdFromUrl, setNoteHash } from '../utils/noteShare';

const formatUpdatedDateTime = (value) => {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const NoteModal = ({ isOpen, note, onClose, onUpdate, onToggleArchive, canShare = false }) => {
  const titleRef = useRef(null);
  const contentTextareaRef = useRef(null);
  const lastRightClickCaretRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const [bodyCopied, setBodyCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const canShareThisNote = !!canShare && !!note && note?.id != null && !note?.__isDraft;

  const shareUrl = useMemo(() => {
    if (!canShareThisNote) return '';
    return buildNoteShareUrl(note.id);
  }, [canShareThisNote, note?.id]);

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

  useEffect(() => {
    if (!isOpen) return;
    // デフォルトは表示モード
    setIsEditing(false);
    setCopied(false);
    setBodyCopied(false);
  }, [isOpen, note?.id]);

  const title = typeof note?.title === 'string' ? note.title : '';
  const content = typeof note?.content === 'string' ? note.content : '';
  const titleTrimmed = title.replace(/\r?\n/g, ' ').trim();
  const contentNormalized = content.replace(/\r\n/g, '\n');
  const contentTrimmed = contentNormalized.trim();
  const updatedLabel = formatUpdatedDateTime(note?.updated_at);
  const isArchived = !!note?.archived;
  const canToggleArchive = !!note && note?.id != null && !note?.__isDraft;

  const markdownBodyForCopy = useMemo(() => {
    const parts = [];
    if (titleTrimmed) {
      parts.push(`# ${titleTrimmed}`);
    }
    if (contentTrimmed) {
      parts.push(contentNormalized);
    }
    if (parts.length === 0) return '';
    return `${parts.join('\n\n').trimEnd()}\n`;
  }, [contentNormalized, contentTrimmed, titleTrimmed]);

  const canCopyMarkdownBody = !!markdownBodyForCopy;

  const extractUrlAt = useCallback((text, caretIndex) => {
    if (typeof text !== 'string' || !text) return null;
    if (typeof caretIndex !== 'number' || !Number.isFinite(caretIndex)) return null;
    const idx = Math.min(Math.max(0, Math.floor(caretIndex)), Math.max(0, text.length - 1));

    const isDelimiter = (ch) => {
      if (!ch) return true;
      return /\s/.test(ch);
    };

    let start = idx;
    while (start > 0 && !isDelimiter(text[start - 1])) start -= 1;
    let end = idx;
    while (end < text.length && !isDelimiter(text[end])) end += 1;

    let token = text.slice(start, end).trim();
    if (!token) return null;

    const stripLeading = new Set(['(', '[', '{', '<']);
    const stripTrailing = new Set([')', ']', '}', '>', ',', '.', '。', '．', '、', '…']);
    while (token.length > 0 && stripLeading.has(token[0])) token = token.slice(1);
    while (token.length > 0 && stripTrailing.has(token[token.length - 1])) token = token.slice(0, -1);
    if (!token) return null;

    if (!/^https?:\/\//i.test(token)) return null;

    try {
      new URL(token);
      return token;
    } catch {
      return null;
    }
  }, []);

  const handleCopyShareUrl = useCallback(async () => {
    if (!canShareThisNote) return;
    if (!shareUrl) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = shareUrl;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        textarea.style.left = '-1000px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error('[Share] Failed to copy note URL:', error);
    }
  }, [canShareThisNote, shareUrl]);

  const handleCopyMarkdownBody = useCallback(async () => {
    if (!canCopyMarkdownBody) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(markdownBodyForCopy);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = markdownBodyForCopy;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        textarea.style.left = '-1000px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setBodyCopied(true);
      window.setTimeout(() => setBodyCopied(false), 1500);
    } catch (error) {
      console.error('[Note] Failed to copy markdown body:', error);
    }
  }, [canCopyMarkdownBody, markdownBodyForCopy]);

  const renderMarkdownLink = useCallback(
    ({ href, children, ...props }) => {
      const safeHref = typeof href === 'string' ? href : '';
      const sharedNoteId = parseNoteIdFromUrl(safeHref);

      return (
        <a
          {...props}
          href={safeHref}
          className="text-blue-600 underline hover:text-blue-800"
          onClick={(event) => {
            if (!safeHref) return;

            if (sharedNoteId != null) {
              const isPlainLeftClick = event.button === 0
                && !event.metaKey
                && !event.ctrlKey
                && !event.shiftKey
                && !event.altKey;
              if (!isPlainLeftClick) {
                return;
              }

              event.preventDefault();
              event.stopPropagation();
              setNoteHash(sharedNoteId);
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            window.open(safeHref, '_blank', 'noopener,noreferrer');
          }}
          onContextMenu={(event) => {
            if (!safeHref) return;
            event.preventDefault();
            event.stopPropagation();
            window.open(safeHref, '_blank', 'noopener,noreferrer');
          }}
          title={safeHref}
        >
          {children}
        </a>
      );
    },
    []
  );

  const handleContentMouseDown = useCallback(() => {
    const el = contentTextareaRef.current;
    if (!el) return;
    if (typeof el.selectionStart !== 'number') return;
    lastRightClickCaretRef.current = el.selectionStart;
  }, []);

  const handleContentContextMenu = useCallback((event) => {
    const el = contentTextareaRef.current;
    if (!el) return;

    const start = typeof el.selectionStart === 'number' ? el.selectionStart : null;
    const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : null;
    if (start != null && end != null && end > start) {
      const selected = content.slice(start, end).trim();
      const selectedUrl = extractUrlAt(selected, 0) || extractUrlAt(selected, Math.min(1, selected.length - 1));
      if (selectedUrl) {
        event.preventDefault();
        event.stopPropagation();
        window.open(selectedUrl, '_blank', 'noopener,noreferrer');
        return;
      }
    }

    const caret = typeof el.selectionStart === 'number'
      ? el.selectionStart
      : (typeof lastRightClickCaretRef.current === 'number' ? lastRightClickCaretRef.current : null);
    const url = extractUrlAt(content, caret);
    if (!url) return;

    event.preventDefault();
    event.stopPropagation();
    window.open(url, '_blank', 'noopener,noreferrer');
  }, [content, extractUrlAt]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black bg-opacity-50 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
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
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!canShareThisNote}
              onClick={handleCopyShareUrl}
              className={`inline-flex items-center justify-center rounded-full border px-3 py-2 text-xs font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
                !canShareThisNote
                  ? 'cursor-not-allowed opacity-40 bg-white border-gray-200 text-gray-400'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-indigo-50'
              }`}
              title={canShareThisNote ? (copied ? 'コピーしました' : '共有URLをコピー') : 'ログイン後に共有できます'}
            >
              {copied ? 'コピー済み' : '共有URL'}
            </button>

            <button
              type="button"
              disabled={!canCopyMarkdownBody}
              onClick={handleCopyMarkdownBody}
              className={`inline-flex items-center justify-center rounded-full border px-3 py-2 text-xs font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
                !canCopyMarkdownBody
                  ? 'cursor-not-allowed opacity-40 bg-white border-gray-200 text-gray-400'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-indigo-50'
              }`}
              title={canCopyMarkdownBody ? (bodyCopied ? 'コピーしました' : '本文をMarkdownでコピー') : '本文が空です'}
            >
              {bodyCopied ? 'コピー済み' : '本文コピー'}
            </button>

            <button
              type="button"
              onClick={() => setIsEditing((prev) => !prev)}
              className="inline-flex items-center justify-center rounded-full border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 transition-colors duration-200 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              title={isEditing ? '表示モードへ' : '編集モードへ'}
            >
              {isEditing ? '表示' : '編集'}
            </button>

            <button
              type="button"
              disabled={!canToggleArchive}
              onClick={() => {
                if (!canToggleArchive) return;
                if (onToggleArchive) {
                  onToggleArchive(note, !isArchived);
                  return;
                }
                if (onUpdate && note?.id != null) {
                  onUpdate(note.id, { archived: !isArchived });
                }
              }}
              className={`inline-flex items-center justify-center rounded-full border px-3 py-2 text-xs font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
                !canToggleArchive
                  ? 'cursor-not-allowed opacity-40 bg-white border-gray-200 text-gray-400'
                  : isArchived
                    ? 'bg-indigo-500 border-indigo-600 text-white hover:bg-indigo-600'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-indigo-50'
              }`}
              title={isArchived ? 'アーカイブから戻す' : 'アーカイブ'}
            >
              {isArchived ? 'アーカイブ解除' : 'アーカイブ'}
            </button>

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
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <div className="space-y-6 p-4">
            {isEditing ? (
              <>
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
                  <label className="block text-gray-700 font-medium mb-2">本文（Markdown対応）</label>
                  <textarea
                    ref={contentTextareaRef}
                    value={content}
                    placeholder="本文"
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition resize-none"
                    style={{ minHeight: '55vh' }}
                    onMouseDown={(event) => {
                      if (event.button === 2) {
                        handleContentMouseDown();
                      }
                    }}
                    onMouseUp={(event) => {
                      if (event.button === 2) {
                        handleContentMouseDown();
                      }
                    }}
                    onContextMenu={handleContentContextMenu}
                    onChange={(e) => {
                      if (onUpdate && note?.id != null) {
                        onUpdate(note.id, { content: e.target.value });
                      }
                    }}
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="block text-gray-700 font-medium mb-2">本文</label>
                <div
                  className="note-markdown w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800"
                  style={{ minHeight: '55vh' }}
                >
                  {content.trim() ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: renderMarkdownLink }}>
                      {content}
                    </ReactMarkdown>
                  ) : (
                    <div className="text-gray-400">（本文なし）</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NoteModal;
