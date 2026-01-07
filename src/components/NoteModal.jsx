import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildNoteShareUrl, parseNoteIdFromUrl, setNoteHash } from '../utils/noteShare';
import { getCachedNoteTitle, getNoteTitleCached } from '../utils/noteTitleCache';
import { useAuth } from '../context/useAuth';
import ConfirmDialog from './ConfirmDialog';

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

const NoteModal = ({ isOpen, note, onClose, onUpdate, onToggleArchive, onToggleImportant, onDeleteNote, onCommitDraft, onTab, canShare = false }) => {
  const titleRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const contentTextareaRef = useRef(null);
  const lastRightClickCaretRef = useRef(null);
  const pendingScrollRatioRef = useRef(0);
  const tagInputRefsRef = useRef({});
  const tagSaveTimerRef = useRef(null);
  const isTagComposingRef = useRef(false);
  const pendingTagFocusIndexRef = useRef(null);
  const isTitleFocusedRef = useRef(false);
  const isContentFocusedRef = useRef(false);
  const isTagsFocusedRef = useRef(false);
  const { user } = useAuth();
  const userId = user?.id || null;
  const [linkedNoteTitles, setLinkedNoteTitles] = useState(() => ({}));
  const [copied, setCopied] = useState(false);
  const [bodyCopied, setBodyCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftTags, setDraftTags] = useState(() => ([]));
  const [titleDirty, setTitleDirty] = useState(false);
  const [contentDirty, setContentDirty] = useState(false);
  const [tagsDirty, setTagsDirty] = useState(false);
  const [activeTagIndex, setActiveTagIndex] = useState(null);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const noteId = note?.id ?? null;
  const noteTitle = typeof note?.title === 'string' ? note.title : '';
  const noteContent = typeof note?.content === 'string' ? note.content : '';
  const noteTags = Array.isArray(note?.tags) ? note.tags : [];

  const tagBankKey = useMemo(() => {
    const id = userId ? String(userId) : 'local';
    return `note_tag_bank:${id}`;
  }, [userId]);

  const loadTagBank = useCallback(() => {
    try {
      const raw = window.localStorage.getItem(tagBankKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed.filter((v) => typeof v === 'string' && v.trim())
        : [];
    } catch {
      return [];
    }
  }, [tagBankKey]);

  const normalizeTags = useCallback((values) => {
    const list = Array.isArray(values) ? values : [];
    const normalized = list
      .map((v) => (typeof v === 'string' ? v : ''))
      .map((v) => v.replace(/\s+/g, ' ').trim())
      .filter((v) => v.length > 0);

    const uniq = [];
    const seen = new Set();
    normalized.forEach((t) => {
      const key = t.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      uniq.push(t);
    });
    return uniq;
  }, []);

  const schedulePersistTags = useCallback((nextTags) => {
    if (!onUpdate) return;
    if (!note || note?.id == null) return;

    if (tagSaveTimerRef.current) {
      clearTimeout(tagSaveTimerRef.current);
    }

    tagSaveTimerRef.current = setTimeout(() => {
      try {
        onUpdate(note.id, { tags: nextTags });
        setTagsDirty(false);
      } catch (error) {
        console.error('[Note] Failed to persist tags:', error);
      }
    }, 250);
  }, [note, onUpdate]);

  useEffect(() => {
    return () => {
      if (tagSaveTimerRef.current) {
        clearTimeout(tagSaveTimerRef.current);
        tagSaveTimerRef.current = null;
      }
    };
  }, [noteId, isOpen]);

  const persistDraftIfNeeded = useCallback(() => {
    if (!onUpdate) return;
    if (!note || note?.id == null) return;

    const patch = {};
    if (draftTitle !== noteTitle) patch.title = draftTitle;
    if (draftContent !== noteContent) patch.content = draftContent;
    const nextTags = normalizeTags(draftTags);
    const prevTags = normalizeTags(noteTags);
    if (JSON.stringify(nextTags) !== JSON.stringify(prevTags)) patch.tags = nextTags;

    if (Object.keys(patch).length === 0) return;

    try {
      onUpdate(note.id, patch);
      setTitleDirty(false);
      setContentDirty(false);
      setTagsDirty(false);
    } catch (error) {
      console.error('[Note] Failed to persist draft:', error);
    }
  }, [draftContent, draftTags, draftTitle, normalizeTags, note, noteContent, noteTags, noteTitle, onUpdate]);

  const handleTabify = useCallback(() => {
    if (!note || note?.id == null) return;

    // タブ化は「一旦隠しておく」目的なので、編集状態のまま閉じて変更が失われないよう、
    // ここでは表示モードへ戻すのと同等の保存処理を行う。
    try {
      if (isEditing) {
        const cleanedTags = normalizeTags(draftTags);
        if (JSON.stringify(cleanedTags) !== JSON.stringify(draftTags)) {
          setDraftTags(cleanedTags);
        }
        schedulePersistTags(cleanedTags);

        persistDraftIfNeeded();

        if (onCommitDraft && note?.id != null && note?.__isDraft) {
          onCommitDraft(note.id, {
            title: draftTitle,
            content: draftContent,
            tags: cleanedTags,
            date: note?.date,
          });
        }

        setIsEditing(false);
      }
    } catch (error) {
      console.error('[Note] Failed to tabify note:', error);
    }

    if (typeof onTab === 'function') {
      onTab(note);
    }
    if (typeof onClose === 'function') {
      onClose();
    }
  }, [draftContent, draftTags, draftTitle, isEditing, normalizeTags, note, onClose, onCommitDraft, onTab, persistDraftIfNeeded, schedulePersistTags]);

  const requestClose = useCallback(() => {
    if (isEditing) {
      setConfirmCloseOpen(true);
      return;
    }
    if (onClose) onClose();
  }, [isEditing, onClose]);

  const canDeleteNote = useMemo(() => {
    if (!note) return false;
    if (note?.id == null) return false;
    if (note?.__isDraft) return false;
    return typeof onDeleteNote === 'function';
  }, [note, onDeleteNote]);

  const handleToggleEditing = useCallback(() => {
    setIsEditing((prev) => {
      const getScrollRatio = (el) => {
        if (!el) return 0;
        const max = (el.scrollHeight ?? 0) - (el.clientHeight ?? 0);
        if (max <= 0) return 0;
        const top = typeof el.scrollTop === 'number' ? el.scrollTop : 0;
        return Math.max(0, Math.min(1, top / max));
      };

      // 編集→表示: このタイミングで保存
      if (prev) {
        const cleanedTags = normalizeTags(draftTags);
        if (JSON.stringify(cleanedTags) !== JSON.stringify(draftTags)) {
          setDraftTags(cleanedTags);
        }
        schedulePersistTags(cleanedTags);

        // 編集側(textarea)のスクロール位置を、表示側コンテナへ引き継ぐ
        pendingScrollRatioRef.current = getScrollRatio(contentTextareaRef.current);

        persistDraftIfNeeded();

        // 新規（下書き）ノートは、表示へ戻した時点で作成しておく。
        // これにより、モーダルを閉じなくても重要/アーカイブ等が押せる。
        if (onCommitDraft && note?.id != null && note?.__isDraft) {
          try {
            onCommitDraft(note.id, {
              title: draftTitle,
              content: draftContent,
              tags: cleanedTags,
              date: note?.date,
            });
          } catch (error) {
            console.error('[Note] Failed to commit draft note:', error);
          }
        }
        return false;
      }

      // 表示→編集: 表示側コンテナのスクロール位置を、編集側(textarea)へ引き継ぐ
      pendingScrollRatioRef.current = getScrollRatio(scrollContainerRef.current);
      return true;
    });
  }, [draftContent, draftTags, draftTitle, normalizeTags, onCommitDraft, note, persistDraftIfNeeded, schedulePersistTags]);

  const handleBodyDoubleClick = useCallback((event) => {
    // 本文エリア内での「リンク/ボタン/チェックボックス」操作は優先
    const target = event.target;
    if (!(target instanceof Element)) {
      handleToggleEditing();
      return;
    }

    if (target.closest('a')) return;
    if (target.closest('button')) return;
    if (target.closest('input[type="checkbox"]')) return;

    handleToggleEditing();
  }, [handleToggleEditing]);

  const tags = Array.isArray(draftTags) ? draftTags : [];

  const tagSuggestions = useMemo(() => {
    if (activeTagIndex == null) return [];
    const current = typeof tags[activeTagIndex] === 'string' ? tags[activeTagIndex] : '';
    const q = current.trim().toLowerCase();
    const bank = loadTagBank();
    const filtered = q
      ? bank.filter((t) => t.toLowerCase().includes(q))
      : bank;
    return filtered.slice(0, 10);
  }, [activeTagIndex, loadTagBank, tags]);

  const updateTagAt = useCallback((index, value) => {
    // NOTE: 日本語IME変換中は確定前の文字列が頻繁にonChangeで飛んでくるため、
    // 履歴保存/同期は「確定時」に寄せる。
    const shouldPersist = !isTagComposingRef.current;

    setDraftTags((prev) => {
      const list = Array.isArray(prev) ? [...prev] : [];
      if (index < 0 || index >= list.length) return list;
      list[index] = value;

      if (shouldPersist) {
        const cleaned = normalizeTags(list);
        schedulePersistTags(cleaned);
      }

      return list;
    });

    setTagsDirty(true);
  }, [normalizeTags, schedulePersistTags]);

  const handleAddTag = useCallback(() => {
    setDraftTags((prev) => {
      const list = Array.isArray(prev) ? [...prev] : [];
      // タグ0件の時は空欄1つをベースとして保持
      if (list.length === 0) {
        list.push('');
      }
      list.push('');
      pendingTagFocusIndexRef.current = list.length - 1;
      return list;
    });
    setTagsDirty(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (!isEditing) return;
    // タグ0件の時は空欄タグを1つ用意（×で消せない）
    if (Array.isArray(draftTags) && draftTags.length === 0) {
      setDraftTags(['']);
    }
  }, [draftTags, isEditing, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!isEditing) return;
    const idx = pendingTagFocusIndexRef.current;
    if (typeof idx !== 'number') return;

    pendingTagFocusIndexRef.current = null;
    setTimeout(() => {
      const el = tagInputRefsRef.current?.[String(idx)] || null;
      el?.focus?.();
    }, 0);
  }, [draftTags, isEditing, isOpen]);

  const handleRemoveTag = useCallback((index) => {
    setDraftTags((prev) => {
      const list = Array.isArray(prev) ? [...prev] : [];
      if (index < 0 || index >= list.length) return list;
      list.splice(index, 1);
      // タグ0件状態でも入力UIを残す
      if (list.length === 0) {
        list.push('');
      }

      const cleaned = normalizeTags(list);
      schedulePersistTags(cleaned);
      return list;
    });
    setTagsDirty(true);
    setActiveTagIndex((prev) => (prev === index ? null : prev));
  }, [normalizeTags, schedulePersistTags]);

  const handleSelectSuggestion = useCallback((value) => {
    if (activeTagIndex == null) return;
    // 候補選択は確定扱い
    isTagComposingRef.current = false;
    updateTagAt(activeTagIndex, value);
    setActiveTagIndex(null);
  }, [activeTagIndex, updateTagAt]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const ratio = pendingScrollRatioRef.current;
    const applyScrollRatio = (el, nextRatio) => {
      if (!el) return;
      const max = (el.scrollHeight ?? 0) - (el.clientHeight ?? 0);
      if (max <= 0) {
        el.scrollTop = 0;
        return;
      }
      el.scrollTop = Math.max(0, Math.min(max, max * nextRatio));
    };

    // DOMが切り替わった直後に反映（ちらつき軽減のためLayoutEffect + rAF）
    requestAnimationFrame(() => {
      if (isEditing) {
        applyScrollRatio(contentTextareaRef.current, ratio);
      } else {
        applyScrollRatio(scrollContainerRef.current, ratio);
      }
    });
  }, [isEditing, isOpen]);

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
    setDraftTags(Array.isArray(noteTags) ? noteTags : []);
    setTitleDirty(false);
    setContentDirty(false);
    setTagsDirty(false);
    setActiveTagIndex(null);
  }, [isOpen, noteContent, noteId, noteTags, noteTitle]);

  useEffect(() => {
    if (!isOpen) return;
    // 編集中（フォーカス中）は同期で上書きしない。非編集中だけ追従。
    if (!titleDirty && !isTitleFocusedRef.current && draftTitle !== noteTitle) {
      setDraftTitle(noteTitle);
    }
    if (!contentDirty && !isContentFocusedRef.current && draftContent !== noteContent) {
      setDraftContent(noteContent);
    }
    if (!tagsDirty && !isTagsFocusedRef.current) {
      const nextTagsRaw = Array.isArray(noteTags) ? noteTags : [];
      const nextNormalized = normalizeTags(nextTagsRaw);
      const currentNormalized = normalizeTags(draftTags);
      // UI都合で編集モードでは空欄タグ（['']）を持つ場合がある。
      // DB側の空配列[]と等価として扱い、追従更新のループを防ぐ。
      if (JSON.stringify(nextNormalized) !== JSON.stringify(currentNormalized)) {
        setDraftTags(nextTagsRaw);
      }
    }
  }, [contentDirty, draftContent, draftTags, draftTitle, isOpen, noteContent, noteTags, noteTitle, tagsDirty, titleDirty]);

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
        <div
          className="flex items-center justify-between gap-3 border-b border-gray-200 p-4"
          onDoubleClick={(event) => {
            // ヘッダーの「空いてる所」をダブルクリックした時だけタブ化
            if (event.target !== event.currentTarget) return;
            handleTabify();
          }}
        >
          <div className="min-w-0">
            <div
              className="text-sm font-semibold text-gray-800 truncate"
              title={title.trim() ? title : '無題のノート'}
            >
              {title.trim() ? title : '無題のノート'}
            </div>
            {updatedLabel && (
              <div className="text-xs text-gray-500">{`更新: ${updatedLabel}`}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
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

        <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <div className={isEditing ? 'flex min-h-full flex-col gap-6 p-4' : 'space-y-6 p-4'}>
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
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <label className="block text-gray-700 font-medium">タグ（検索用）</label>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {tags.map((tag, idx) => {
                      const raw = typeof tag === 'string' ? tag : '';
                      const isOnlyPlaceholder = tags.length === 1 && raw.replace(/\s+/g, '').length === 0;
                      const canRemove = !isOnlyPlaceholder;

                      return (
                        <div key={`tag-${idx}`} className="relative inline-flex items-center gap-1">
                          <input
                            ref={(el) => {
                              if (el) tagInputRefsRef.current[String(idx)] = el;
                            }}
                            type="text"
                            value={typeof tag === 'string' ? tag : ''}
                            placeholder="タグ"
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                            className="h-8 w-40 rounded-full border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:border-indigo-300"
                            onFocus={() => {
                              isTagsFocusedRef.current = true;
                              setActiveTagIndex(idx);
                            }}
                            onCompositionStart={() => {
                              isTagComposingRef.current = true;
                            }}
                            onCompositionEnd={() => {
                              // 変換確定: この時点の値で同期＆履歴登録
                              isTagComposingRef.current = false;
                              const cleaned = normalizeTags(tags);
                              schedulePersistTags(cleaned);
                            }}
                            onBlur={() => {
                              isTagsFocusedRef.current = false;
                              if (!isTagComposingRef.current) {
                                const cleaned = normalizeTags(tags);
                                schedulePersistTags(cleaned);
                              }
                              setTimeout(() => setActiveTagIndex((prev) => (prev === idx ? null : prev)), 120);
                            }}
                            onChange={(e) => {
                              updateTagAt(idx, e.target.value);
                            }}
                          />

                          {canRemove && (
                            <button
                              type="button"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 transition-colors duration-200 hover:bg-gray-50 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                              onClick={() => handleRemoveTag(idx)}
                              aria-label="タグを削除"
                              title="タグを削除"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="M18 6L6 18" />
                                <path d="M6 6l12 12" />
                              </svg>
                            </button>
                          )}

                          {activeTagIndex === idx && tagSuggestions.length > 0 && (
                            <div className="absolute left-0 top-full z-10 mt-1 w-56 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                              {tagSuggestions.map((t) => (
                                <button
                                  key={`tag-suggest-${t}`}
                                  type="button"
                                  className="block w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                  onMouseDown={(ev) => ev.preventDefault()}
                                  onClick={() => handleSelectSuggestion(t)}
                                >
                                  {t}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      onClick={handleAddTag}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 transition-colors duration-200 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                      aria-label="タグを追加"
                      title="タグを追加"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 5v14" />
                        <path d="M5 12h14" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className="flex flex-1 min-h-0 flex-col">
                  <label className="block text-gray-700 font-medium mb-2">本文（Markdown対応）</label>
                  <textarea
                    ref={contentTextareaRef}
                    value={content}
                    placeholder="本文"
                    className="w-full flex-1 min-h-0 border border-gray-300 rounded-lg px-4 py-3 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition resize-none"
                    onDoubleClick={handleBodyDoubleClick}
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
              <>
                {tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pb-1">
                    {tags
                      .map((t) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : ''))
                      .filter((t) => t)
                      .map((t) => (
                        <span
                          key={`tag-view-${t}`}
                          className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600"
                          title={t}
                        >
                          {t}
                        </span>
                      ))}
                  </div>
                )}

                <div className="note-markdown w-full px-1 text-sm text-gray-800" onDoubleClick={handleBodyDoubleClick}>
                  {content.trim() ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        a: renderMarkdownLink,
                        input: ({ type, ...props }) => {
                          if (type === 'checkbox') {
                            return (
                              <input
                                {...props}
                                type="checkbox"
                                className="custom-checkbox mr-2 align-middle"
                                disabled
                              />
                            );
                          }
                          return <input {...props} type={type} />;
                        },
                      }}
                    >
                      {content}
                    </ReactMarkdown>
                  ) : (
                    <div className="text-gray-400">（本文なし）</div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="border-t border-gray-200 p-4">
          <div className="flex flex-wrap items-center justify-start gap-2">
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
              disabled={!canDeleteNote}
              onClick={() => {
                if (!canDeleteNote) return;
                setConfirmDeleteOpen(true);
              }}
              className={`inline-flex h-9 w-9 p-1 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 focus-visible:ring-offset-1 focus-visible:ring-offset-white ${
                !canDeleteNote
                  ? 'cursor-not-allowed opacity-40 bg-white border-gray-200 text-gray-400'
                  : 'bg-white border-gray-200 text-red-600 hover:bg-red-50'
              }`}
              title={canDeleteNote ? '削除' : '下書きは削除できません'}
              aria-label={canDeleteNote ? '削除' : '下書きは削除できません'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18" />
                <path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
              </svg>
            </button>

          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCloseOpen}
        title="確認"
        message="編集モードのまま閉じると、変更は保存されません。閉じますか？"
        confirmText="閉じる"
        cancelText="キャンセル"
        onCancel={() => setConfirmCloseOpen(false)}
        onConfirm={() => {
          setConfirmCloseOpen(false);
          if (onClose) onClose();
        }}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="削除しますか？"
        message="このノートを削除します。元に戻せません。"
        confirmText="削除"
        cancelText="キャンセル"
        variant="danger"
        onCancel={() => setConfirmDeleteOpen(false)}
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          if (typeof onDeleteNote === 'function') {
            try {
              onDeleteNote(note);
            } catch (error) {
              console.error('[Note] Failed to delete note:', error);
            }
          }
          if (onClose) onClose();
        }}
      />
    </div>
  );
};

export default NoteModal;
