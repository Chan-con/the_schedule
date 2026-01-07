import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import NoteModal from './NoteModal';

const formatUpdatedDate = (value) => {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' });
};

const normalizeText = (value) => (typeof value === 'string' ? value : '');

const normalizeTags = (value) => {
  const list = Array.isArray(value) ? value : [];
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
};

const toLocalDateStr = (value) => {
  if (!value) return '';
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const NoteArea = ({
  notes = [],
  onUpdateNote,
  onDeleteNote,
  onToggleArchiveNote,
  onToggleImportantNote,
  onCommitDraftNote,
  onLoadMoreArchived,
  archivedHasMore = false,
  archivedLoading = false,
  canShare = false,
  selectedDateStr = '',
  activeNoteId: controlledActiveNoteId,
  onActiveNoteIdChange,
  onRequestClose,
  onTabNote,
}) => {
  const [query, setQuery] = useState('');
  const [committedQuery, setCommittedQuery] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [internalActiveNoteId, setInternalActiveNoteId] = useState(null);
  const scrollContainerRef = useRef(null);
  const archivedSentinelRef = useRef(null);

  const resolvedActiveNoteId = controlledActiveNoteId !== undefined ? controlledActiveNoteId : internalActiveNoteId;
  const setActiveNoteId = useCallback(
    (nextId) => {
      if (controlledActiveNoteId !== undefined) {
        if (onActiveNoteIdChange) onActiveNoteIdChange(nextId);
        return;
      }
      setInternalActiveNoteId(nextId);
    },
    [controlledActiveNoteId, onActiveNoteIdChange]
  );

  const noteList = useMemo(() => (Array.isArray(notes) ? notes : []), [notes]);

  const sortedNotes = useMemo(() => {
    const list = Array.isArray(noteList) ? [...noteList] : [];
    const selected = typeof selectedDateStr === 'string' ? selectedDateStr : '';

    const toTime = (value) => {
      if (!value) return 0;
      const dt = new Date(value);
      const t = dt.getTime();
      return Number.isNaN(t) ? 0 : t;
    };

    list.sort((a, b) => {
      const aCreated = toLocalDateStr(a?.created_at);
      const bCreated = toLocalDateStr(b?.created_at);
      const aIsCreatedOnSelected = !!selected && aCreated === selected;
      const bIsCreatedOnSelected = !!selected && bCreated === selected;
      if (aIsCreatedOnSelected !== bIsCreatedOnSelected) {
        return aIsCreatedOnSelected ? -1 : 1;
      }

      const updatedDiff = toTime(b?.updated_at) - toTime(a?.updated_at);
      if (updatedDiff !== 0) return updatedDiff;
      return String(b?.id ?? '').localeCompare(String(a?.id ?? ''));
    });

    return list;
  }, [noteList, selectedDateStr]);

  useEffect(() => {
    // controlled の場合は親がライフサイクル管理するため、ここで強制クローズしない
    if (controlledActiveNoteId !== undefined) return;
    if (resolvedActiveNoteId == null) return;
    const exists = noteList.some((n) => (n?.id ?? null) === resolvedActiveNoteId);
    if (!exists) {
      setActiveNoteId(null);
    }
  }, [controlledActiveNoteId, noteList, resolvedActiveNoteId, setActiveNoteId]);


  const filteredNotes = useMemo(() => {
    const raw = normalizeText(committedQuery).trim();
    if (!raw) return sortedNotes;

    const tokens = raw.split(/\s+/).filter(Boolean);
    const tagTokens = [];
    const textTokens = [];
    tokens.forEach((token) => {
      const lower = token.toLowerCase();
      if (lower.startsWith('tag:')) {
        const tag = token.slice(4).trim();
        if (tag) tagTokens.push(tag.toLowerCase());
      } else {
        textTokens.push(lower);
      }
    });
    const q = textTokens.join(' ').trim();

    return sortedNotes.filter((note) => {
      const title = normalizeText(note?.title).toLowerCase();
      const content = normalizeText(note?.content).toLowerCase();

      if (q && !(title.includes(q) || content.includes(q))) {
        return false;
      }

      if (tagTokens.length > 0) {
        const tags = normalizeTags(note?.tags).map((t) => t.toLowerCase());
        const ok = tagTokens.every((t) => tags.includes(t));
        if (!ok) return false;
      }

      return true;
    });
  }, [sortedNotes, committedQuery]);

  const appendTagQuery = useCallback((tagValue) => {
    const tag = normalizeText(tagValue).replace(/\s+/g, ' ').trim();
    if (!tag) return;
    const token = `tag:${tag}`;
    setQuery((prev) => {
      const current = normalizeText(prev);
      const has = current
        .split(/\s+/)
        .some((t) => t.toLowerCase() === token.toLowerCase());
      if (has) return current;
      const spacer = current.trim() ? ' ' : '';
      const next = `${current}${spacer}${token}`;
      setCommittedQuery(next);
      return next;
    });
  }, []);

  const { activeNotes, archivedNotes } = useMemo(() => {
    const active = [];
    const archived = [];
    (Array.isArray(filteredNotes) ? filteredNotes : []).forEach((note) => {
      if (note?.archived) {
        archived.push(note);
      } else {
        active.push(note);
      }
    });
    return { activeNotes: active, archivedNotes: archived };
  }, [filteredNotes]);

  useEffect(() => {
    if (!archivedHasMore) return;
    if (archivedLoading) return;
    const root = scrollContainerRef.current;
    const target = archivedSentinelRef.current;
    if (!root || !target) return;
    if (typeof IntersectionObserver === 'undefined') return;

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (cancelled) return;
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (typeof onLoadMoreArchived === 'function') {
          onLoadMoreArchived();
        }
      },
      {
        root,
        threshold: 1,
      }
    );

    observer.observe(target);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [archivedHasMore, archivedLoading, onLoadMoreArchived]);

  const { importantNotes, normalActiveNotes } = useMemo(() => {
    const important = [];
    const normal = [];
    (Array.isArray(activeNotes) ? activeNotes : []).forEach((note) => {
      if (note?.important) {
        important.push(note);
      } else {
        normal.push(note);
      }
    });
    return { importantNotes: important, normalActiveNotes: normal };
  }, [activeNotes]);

  const handleOpen = useCallback((noteId) => {
    if (noteId == null) return;
    setActiveNoteId(noteId);
  }, [setActiveNoteId]);

  const renderNoteCard = (note) => {
    if (!note) return null;
    const noteId = note?.id ?? null;
    const title = normalizeText(note?.title);
    const tags = normalizeTags(note?.tags);
    const updatedLabel = formatUpdatedDate(note?.updated_at);
    const isArchived = !!note?.archived;

    return (
      <div
        key={noteId ?? `note-${Math.random()}`}
        className={`border border-gray-200 rounded-lg bg-white shadow-sm transition hover:shadow-md ${
          isArchived ? 'opacity-70' : ''
        }`}
      >
        <button
          type="button"
          className="w-full text-left p-2.5 bg-white rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
          onClick={() => handleOpen(noteId)}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`font-medium truncate ${isArchived ? 'text-gray-500' : 'text-gray-900'}`}
                  title={title.trim() ? title : '無題のノート'}
                >
                  {title.trim() ? title : '無題のノート'}
                </span>
              </div>

              {tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {tags.map((t) => (
                    <span
                      key={`note-tag-${noteId ?? 'x'}-${t}`}
                      role="button"
                      tabIndex={0}
                      className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-600"
                      title={`tag:${t}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        appendTagQuery(t);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          appendTagQuery(t);
                        }
                      }}
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {updatedLabel && (
                <div className="flex items-center gap-1 text-xs text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2h-2.5l-.72-1.447A1 1 0 0014.854 3h-5.708a1 1 0 00-.926.553L7.5 5H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span>{`更新: ${updatedLabel}`}</span>
                </div>
              )}
            </div>
          </div>
        </button>
      </div>
    );
  };

  const activeNote = useMemo(() => {
    if (resolvedActiveNoteId == null) return null;
    return noteList.find((n) => (n?.id ?? null) === resolvedActiveNoteId) || null;
  }, [resolvedActiveNoteId, noteList]);

  const handleClose = useCallback(() => {
    if (onRequestClose) {
      onRequestClose(resolvedActiveNoteId);
      return;
    }
    setActiveNoteId(null);
  }, [onRequestClose, resolvedActiveNoteId, setActiveNoteId]);

  const handleTabify = useCallback(
    (note) => {
      if (typeof onTabNote === 'function') {
        onTabNote(note);
      }
    },
    [onTabNote]
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-white">
      <div className="px-4 pt-3 pb-2 bg-white">
        <input
          type="text"
          value={query}
          onChange={(event) => {
            const next = event.target.value;
            setQuery(next);
            if (!isComposing) {
              setCommittedQuery(next);
            }
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={(event) => {
            setIsComposing(false);
            setCommittedQuery(event.target.value);
          }}
          placeholder="ノートを検索（タイトル / 本文 / tag:xxx）"
          className="w-full rounded-full border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-indigo-300"
        />
      </div>

      <div ref={scrollContainerRef} className="custom-scrollbar flex-1 overflow-y-auto px-4 pb-3 bg-white">
        {filteredNotes.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-2 text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2h-2.5l-.72-1.447A1 1 0 0014.854 3h-5.708a1 1 0 00-.926.553L7.5 5H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-sm">該当するノートはありません</p>
            <p className="text-xs text-gray-300">右上の「＋」でノートを追加できます</p>
          </div>
        ) : (
          <div className="card-stack pt-1">
            {importantNotes.length > 0 && (
              <div className="mb-1 flex items-center gap-2 text-xs text-amber-600">
                <span className="flex-1 h-px bg-amber-100" />
                <span className="tracking-wide">重要</span>
                <span className="flex-1 h-px bg-amber-100" />
              </div>
            )}

            {importantNotes.map((note) => renderNoteCard(note))}

            {importantNotes.length > 0 && normalActiveNotes.length > 0 && (
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-300">
                <span className="flex-1 h-px bg-gray-100" />
                <span className="tracking-wide">すべて</span>
                <span className="flex-1 h-px bg-gray-100" />
              </div>
            )}

            {normalActiveNotes.map((note) => renderNoteCard(note))}

            {archivedNotes.length > 0 && (
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                <span className="flex-1 h-px bg-gray-200" />
                <span className="tracking-wide">アーカイブ</span>
                <span className="flex-1 h-px bg-gray-200" />
              </div>
            )}

            {archivedNotes.map((note) => renderNoteCard(note))}

            {archivedHasMore && <div ref={archivedSentinelRef} className="h-6" />}
          </div>
        )}
      </div>

      <NoteModal
        isOpen={resolvedActiveNoteId != null}
        note={activeNote}
        onClose={handleClose}
        onUpdate={onUpdateNote}
        onToggleArchive={onToggleArchiveNote}
        onToggleImportant={onToggleImportantNote}
        onCommitDraft={onCommitDraftNote}
        onTab={handleTabify}
        canShare={canShare}
      />
    </div>
  );
};

export default NoteArea;
