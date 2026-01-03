import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildNoteShareUrl, parseNoteIdFromUrl, setNoteHash } from '../utils/noteShare';
import { getCachedNoteTitle, getNoteTitleCached } from '../utils/noteTitleCache';
import { useAuth } from '../context/useAuth';

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

const NoteModal = ({ isOpen, note, onClose, onUpdate, onToggleArchive, onToggleImportant, canShare = false }) => {
  const titleRef = useRef(null);
  const contentTextareaRef = useRef(null);
  const lastRightClickCaretRef = useRef(null);
  const isTitleFocusedRef = useRef(false);
  const isContentFocusedRef = useRef(false);
  const { user } = useAuth();
  const userId = user?.id || null;
  const [linkedNoteTitles, setLinkedNoteTitles] = useState(() => ({}));
  const [copied, setCopied] = useState(false);
  const [bodyCopied, setBodyCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [titleDirty, setTitleDirty] = useState(false);
  const [contentDirty, setContentDirty] = useState(false);

  const noteId = note?.id ?? null;
  const noteTitle = typeof note?.title === 'string' ? note.title : '';
  const noteContent = typeof note?.content === 'string' ? note.content : '';

  const persistDraftIfNeeded = useCallback(() => {
    if (!onUpdate) return;
    if (!note || note?.id == null) return;

    const patch = {};
    if (draftTitle !== noteTitle) patch.title = draftTitle;
    if (draftContent !== noteContent) patch.content = draftContent;

    if (Object.keys(patch).length === 0) return;

    try {
      onUpdate(note.id, patch);
      setTitleDirty(false);
      setContentDirty(false);
    } catch (error) {
      console.error('[Note] Failed to persist draft:', error);
    }
  }, [draftContent, draftTitle, note, noteContent, noteTitle, onUpdate]);

  const requestClose = useCallback(() => {
    if (isEditing) {
      const ok = window.confirm('編集モードのまま閉じると、変更は保存されません。閉じますか？');
      if (!ok) return;
    }
    if (onClose) onClose();
  }, [isEditing, onClose]);

  const handleToggleEditing = useCallback(() => {
    setIsEditing((prev) => {
      // 編集→表示: このタイミングで保存
      if (prev) {
        persistDraftIfNeeded();
        return false;
      }
      return true;
    });
  }, [persistDraftIfNeeded]);

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
        requestClose();
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
  }, [isOpen, requestClose]);

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

  useEffect(() => {
    if (!isOpen) return;
    // ノート切替/初回オープン時だけドラフトを初期化
    setDraftTitle(noteTitle);
    setDraftContent(noteContent);
    setTitleDirty(false);
    setContentDirty(false);
  }, [isOpen, noteContent, noteId, noteTitle]);

  useEffect(() => {
    if (!isOpen) return;
    // 編集中（フォーカス中）は同期で上書きしない。非編集中だけ追従。
    if (!titleDirty && !isTitleFocusedRef.current && draftTitle !== noteTitle) {
      setDraftTitle(noteTitle);
    }
    if (!contentDirty && !isContentFocusedRef.current && draftContent !== noteContent) {
      setDraftContent(noteContent);
    }
  }, [contentDirty, draftContent, draftTitle, isOpen, noteContent, noteTitle, titleDirty]);

  const title = draftTitle;
  const content = draftContent;
  const titleTrimmed = title.replace(/\r?\n/g, ' ').trim();
  const contentNormalized = content.replace(/\r\n/g, '\n');
  const contentTrimmed = contentNormalized.trim();
  const updatedLabel = formatUpdatedDateTime(note?.updated_at);
  const isArchived = !!note?.archived;
  const isImportant = !!note?.important;
  const canToggleArchive = !!note && note?.id != null && !note?.__isDraft;
  const canToggleImportant = !!note && note?.id != null && !note?.__isDraft;

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

      const childText = Array.isArray(children)
        ? children.map((c) => (typeof c === 'string' ? c : '')).join('')
        : (typeof children === 'string' ? children : '');

      const resolvedTitle = (sharedNoteId != null && userId)
        ? (linkedNoteTitles[String(sharedNoteId)] || getCachedNoteTitle({ userId, id: sharedNoteId }))
        : null;

      const shouldReplaceLabel = sharedNoteId != null
        && !!resolvedTitle
        && childText
        && childText.trim() === safeHref;

      const linkLabel = shouldReplaceLabel ? resolvedTitle : children;

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
          {linkLabel}
        </a>
      );
    },
    [linkedNoteTitles, userId]
  );

  useEffect(() => {
    if (!isOpen) return;
    if (!userId) return;

    const urlPattern = /(https?:\/\/[^\s]+)/gi;
    const matches = content.match(urlPattern) || [];
    const ids = Array.from(
      new Set(
        matches
          .map((rawUrl) => parseNoteIdFromUrl(rawUrl))
          .filter((v) => v != null)
          .map((v) => String(v))
      )
    );
    if (ids.length === 0) return;

    let cancelled = false;

    const ensureTitles = async () => {
      const updates = {};
      const tasks = ids.map(async (id) => {
        const cached = getCachedNoteTitle({ userId, id });
        if (cached) {
          updates[id] = cached;
          return;
        }
        try {
          const title = await getNoteTitleCached({ userId, id });
          updates[id] = title;
        } catch {
          // ignore
        }
      });

      await Promise.allSettled(tasks);
      if (cancelled) return;
      const keys = Object.keys(updates);
      if (keys.length === 0) return;
      setLinkedNoteTitles((prev) => ({ ...prev, ...updates }));
    };

    ensureTitles();
    return () => {
      cancelled = true;
    };
  }, [content, isOpen, userId]);

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
        if (e.target === e.currentTarget) {
          requestClose();
        }
      }}
    >
      <div className="note-modal-content flex h-[calc(100svh-2rem)] w-full max-w-[980px] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
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
              className={`inline-flex h-9 w-9 p-1 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
                !canShareThisNote
                  ? 'cursor-not-allowed opacity-40 bg-white border-gray-200 text-gray-400'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-indigo-50'
              }`}
              title={canShareThisNote ? (copied ? 'コピーしました' : '共有URLをコピー') : 'ログイン後に共有できます'}
              aria-label={canShareThisNote ? (copied ? '共有URLをコピーしました' : '共有URLをコピー') : 'ログイン後に共有できます'}
            >
              {copied ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1" />
                  <path d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1" />
                </svg>
              )}
            </button>

            <button
              type="button"
              disabled={!canCopyMarkdownBody}
              onClick={handleCopyMarkdownBody}
              className={`inline-flex h-9 w-9 p-1 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
                !canCopyMarkdownBody
                  ? 'cursor-not-allowed opacity-40 bg-white border-gray-200 text-gray-400'
                  : 'bg-white border-gray-200 text-gray-600 hover:bg-indigo-50'
              }`}
              title={canCopyMarkdownBody ? (bodyCopied ? 'コピーしました' : '本文をMarkdownでコピー') : '本文が空です'}
              aria-label={canCopyMarkdownBody ? (bodyCopied ? '本文をコピーしました' : '本文をMarkdownでコピー') : '本文が空です'}
            >
              {bodyCopied ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={handleToggleEditing}
              className="inline-flex h-9 w-9 p-1 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors duration-200 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white"
              title={isEditing ? '表示モードへ' : '編集モードへ'}
              aria-label={isEditing ? '表示モードへ' : '編集モードへ'}
            >
              {isEditing ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
              )}
            </button>

            <button
              type="button"
              disabled={!canToggleImportant}
              onClick={() => {
                if (!canToggleImportant) return;
                if (onToggleImportant) {
                  onToggleImportant(note, !isImportant);
                }
              }}
              className={`inline-flex h-9 w-9 p-1 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
                !canToggleImportant
                  ? 'cursor-not-allowed opacity-40 bg-white border-gray-200 text-gray-400'
                  : isImportant
                    ? 'bg-amber-400 border-amber-500 text-white hover:bg-amber-500'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-amber-50'
              }`}
              title={isImportant ? '重要を外す' : '重要'}
              aria-label={isImportant ? '重要を外す' : '重要'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill={isImportant ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
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
              className={`inline-flex h-9 w-9 p-1 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
                !canToggleArchive
                  ? 'cursor-not-allowed opacity-40 bg-white border-gray-200 text-gray-400'
                  : isArchived
                    ? 'bg-indigo-500 border-indigo-600 text-white hover:bg-indigo-600'
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-indigo-50'
              }`}
              title={isArchived ? 'アーカイブから戻す' : 'アーカイブ'}
              aria-label={isArchived ? 'アーカイブから戻す' : 'アーカイブ'}
            >
              {isArchived ? (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 8v13H3V8" />
                  <path d="M1 3h22v5H1z" />
                  <path d="M10 12h4" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 8v13H3V8" />
                  <path d="M1 3h22v5H1z" />
                  <path d="M10 12h4" />
                </svg>
              )}
            </button>

            <button
              type="button"
              onClick={requestClose}
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
                    onFocus={() => {
                      isTitleFocusedRef.current = true;
                    }}
                    onBlur={() => {
                      isTitleFocusedRef.current = false;
                    }}
                    onChange={(e) => {
                      const next = e.target.value;
                      setDraftTitle(next);
                      setTitleDirty(next !== noteTitle);
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
                    onFocus={() => {
                      isContentFocusedRef.current = true;
                    }}
                    onBlur={() => {
                      isContentFocusedRef.current = false;
                    }}
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
                      const next = e.target.value;
                      setDraftContent(next);
                      setContentDirty(next !== noteContent);
                    }}
                  />
                </div>
              </>
            ) : (
              <div className="note-markdown w-full px-1 text-sm text-gray-800">
                {content.trim() ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: renderMarkdownLink }}>
                    {content}
                  </ReactMarkdown>
                ) : (
                  <div className="text-gray-400">（本文なし）</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NoteModal;
