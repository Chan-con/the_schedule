import React, { useEffect, useMemo, useState } from 'react';
import { parseNoteIdFromUrl, setNoteHash } from '../utils/noteShare';
import { useAuth } from '../context/useAuth';
import { getCachedNoteTitle, getNoteTitleCached } from '../utils/noteTitleCache';

const MemoWithLinks = ({ memo, className = '', onHoverChange }) => {
  const { user } = useAuth();
  const userId = user?.id || null;
  const [noteTitles, setNoteTitles] = useState(() => ({}));

  const safeMemo = typeof memo === 'string' ? memo : '';

  const normalizedMemo = useMemo(() => {
    // Windows の改行(\r\n)や単体(\r)を \n に正規化
    return safeMemo.replace(/\r\n?/g, '\n');
  }, [safeMemo]);

  const handleMouseEnter = () => {
    if (onHoverChange) {
      onHoverChange(true);
    }
  };

  const handleMouseLeave = () => {
    if (onHoverChange) {
      onHoverChange(false);
    }
  };

  // 改行で分割して各行を処理
  const lines = normalizedMemo.split('\n');

  const sharedNoteIds = useMemo(() => {
    const ids = new Set();
    const urlPattern = /(https?:\/\/[^\s]+)/gi;
    const matches = normalizedMemo.match(urlPattern) || [];
    matches.forEach((rawUrl) => {
      const id = parseNoteIdFromUrl(rawUrl);
      if (id != null) ids.add(String(id));
    });
    return Array.from(ids);
  }, [normalizedMemo]);

  useEffect(() => {
    if (!userId) return;
    if (sharedNoteIds.length === 0) return;

    let cancelled = false;

    const ensureTitles = async () => {
      const updates = {};
      const tasks = sharedNoteIds.map(async (id) => {
        const cached = getCachedNoteTitle({ userId, id });
        if (cached) {
          updates[id] = cached;
          return;
        }
        try {
          const title = await getNoteTitleCached({ userId, id });
          updates[id] = title;
        } catch {
          // ignore; fallback to URL display
        }
      });

      await Promise.allSettled(tasks);
      if (cancelled) return;

      const keys = Object.keys(updates);
      if (keys.length === 0) return;
      setNoteTitles((prev) => ({ ...prev, ...updates }));
    };

    ensureTitles();
    return () => {
      cancelled = true;
    };
  }, [sharedNoteIds, userId]);

  const formatUrlForDisplay = (urlStr, maxLen = 30) => {
    try {
      const u = new URL(urlStr);
      const host = (u.hostname || '').replace(/^www\./, '');
      let path = u.pathname || '';
      if (path === '/') path = '';
      let base = host + path;
      if (!base) base = u.host || urlStr;
      if (base.length > maxLen) {
        const keep = Math.max(0, maxLen - host.length - 1);
        const sliced = keep > 0 ? path.slice(0, keep) : '';
        return `${host}${sliced}…`;
      }
      return base;
  } catch {
      // フォールバック: プロトコル・クエリ・ハッシュを除去して短縮
      const clean = urlStr
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .split(/[?#]/)[0];
      return clean.length > maxLen ? clean.slice(0, maxLen - 1) + '…' : clean;
    }
  };

  const renderLine = (line, lineIndex) => {
    if (!line) {
      // 空行の場合：ここでは <br> を出さない（外側の行区切り <br> に任せて二重改行を防ぐ）
      return <span key={`empty-${lineIndex}`} />;
    }

    // URLを含むかチェック
    const hasUrl = line.toLowerCase().includes('http://') || line.toLowerCase().includes('https://');
    
    if (!hasUrl) {
      // URLがない場合は通常のテキスト（選択可能）
      return (
        <span 
          key={`line-${lineIndex}`}
          className="select-text"
          style={{ userSelect: 'text', cursor: 'text' }}
        >
          {line}
        </span>
      );
    }

    // URLがある場合は分割して処理
    const urlPattern = /(https?:\/\/[^\s]+)/gi;
    const parts = line.split(urlPattern);

    return (
      <span key={`line-${lineIndex}`}>
        {parts.map((part, partIndex) => {
          const isUrl = part.toLowerCase().startsWith('http://') || part.toLowerCase().startsWith('https://');
          
          if (isUrl) {
            const sharedNoteId = parseNoteIdFromUrl(part);
            const cachedTitle = sharedNoteId != null && userId
              ? getCachedNoteTitle({ userId, id: sharedNoteId })
              : null;
            const display = sharedNoteId != null
              ? (noteTitles[String(sharedNoteId)] || cachedTitle || '無題のノート')
              : formatUrlForDisplay(part);
            return (
              <a
                key={`url-${lineIndex}-${partIndex}`}
                className="text-blue-600 underline hover:text-blue-800 transition-colors font-medium select-text"
                href={part}
                target={sharedNoteId == null ? '_blank' : undefined}
                rel={sharedNoteId == null ? 'noopener noreferrer' : undefined}
                onClick={(e) => {
                  // 共有ノートURLは「通常の左クリック」だけアプリ内で開く。
                  // 右クリック/別タブ/コピーはブラウザ標準のリンク挙動に任せる。
                  if (sharedNoteId == null) return;

                  const isPlainLeftClick = e.button === 0
                    && !e.metaKey
                    && !e.ctrlKey
                    && !e.shiftKey
                    && !e.altKey;
                  if (!isPlainLeftClick) return;

                  e.preventDefault();
                  e.stopPropagation();
                  setNoteHash(sharedNoteId);
                }}
                title={part}
                style={{ 
                  color: '#2563eb', 
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  userSelect: 'text'
                }}
              >
                {display}
              </a>
            );
          }
          return <span 
            key={`text-${lineIndex}-${partIndex}`}
            className="select-text"
            style={{ userSelect: 'text', cursor: 'text' }}
          >
            {part}
          </span>;
        })}
      </span>
    );
  };

  return (
    normalizedMemo ? (
    <div 
      className={`${className} select-text`} 
      style={{ 
        whiteSpace: 'pre-wrap',
        userSelect: 'text',
        cursor: 'text'
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {lines.map((line, index) => (
        <React.Fragment key={`fragment-${index}`}>
          {renderLine(line, index)}
          {index < lines.length - 1 ? '\n' : null}
        </React.Fragment>
      ))}
    </div>
    ) : null
  );
};

export default MemoWithLinks;
