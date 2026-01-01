import React from 'react';
import { parseNoteIdFromUrl, setNoteHash } from '../utils/noteShare';

const MemoWithLinks = ({ memo, className = '', onHoverChange }) => {
  if (!memo) return null;

  console.log('🔍 MemoWithLinks received memo:', memo);

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

  const handleUrlRightClick = (url, e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('🖱️ URL right-clicked:', url);
    
    if (window.electronAPI && window.electronAPI.openUrl) {
      console.log('📞 Calling electronAPI.openUrl...');
      window.electronAPI.openUrl(url).then(result => {
        console.log('📞 electronAPI.openUrl result:', result);
        if (result && result.success) {
          console.log('✅ URL opened successfully:', url);
        } else {
          console.error('❌ Failed to open URL:', result);
        }
      }).catch(error => {
        console.error('❌ Error opening URL:', error);
      });
    } else {
      console.error('❌ electronAPI.openUrl is not available');
      console.error('❌ Available electronAPI methods:', Object.keys(window.electronAPI || {}));
    }
  };

  // 改行で分割して各行を処理
  const lines = memo.split('\n');
  console.log('📄 Split into lines:', lines);

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
      // 空行の場合
      return <br key={`br-${lineIndex}`} />;
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
    console.log(`🧩 Line ${lineIndex} split parts:`, parts);

    return (
      <span key={`line-${lineIndex}`}>
        {parts.map((part, partIndex) => {
          const isUrl = part.toLowerCase().startsWith('http://') || part.toLowerCase().startsWith('https://');
          console.log(`🧩 Part ${partIndex}: "${part}" isUrl: ${isUrl}`);
          
          if (isUrl) {
            const sharedNoteId = parseNoteIdFromUrl(part);
            const display = formatUrlForDisplay(part);
            return (
              <span
                key={`url-${lineIndex}-${partIndex}`}
                className="text-blue-600 underline hover:text-blue-800 transition-colors font-medium select-text"
                onContextMenu={(e) => handleUrlRightClick(part, e)}
                onClick={(e) => {
                  if (sharedNoteId == null) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setNoteHash(sharedNoteId);
                }}
                title={`${part}\n(右クリックでブラウザで開く)`}
                style={{ 
                  color: '#2563eb', 
                  textDecoration: 'underline',
                  cursor: sharedNoteId != null ? 'pointer' : 'text',
                  userSelect: 'text'
                }}
              >
                {display}
              </span>
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
          {index < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </div>
  );
};

export default MemoWithLinks;
