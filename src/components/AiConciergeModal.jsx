import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fromDateStrLocal, toDateStrLocal } from '../utils/date';

const makeId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const normalizeText = (v) => (typeof v === 'string' ? v.trim() : '');

const AI_API_KEY_STORAGE_KEY = 'aiConciergeOpenAIApiKey';

const getSavedAiApiKey = () => {
  try {
    const v = typeof window !== 'undefined' ? window.localStorage.getItem(AI_API_KEY_STORAGE_KEY) : '';
    return normalizeText(v);
  } catch {
    return '';
  }
};

const formatScheduleLabel = (item) => {
  const date = normalizeText(item?.date);
  const time = normalizeText(item?.time);
  const name = normalizeText(item?.name) || '名称未設定';
  const isTask = !!item?.isTask;
  const completed = !!item?.completed;
  const kind = isTask ? (completed ? 'タスク(完了)' : 'タスク') : '予定';
  const head = [date, time].filter(Boolean).join(' ');
  return `${name}（${[head, kind].filter(Boolean).join(' / ')}）`;
};

const parseTimeToHHMM = (text) => {
  const s = normalizeText(text);
  if (!s) return '';

  // 13:30 / 13：30
  {
    const m = /(\d{1,2})\s*[:：]\s*(\d{2})/.exec(s);
    if (m) {
      const hh = Math.max(0, Math.min(23, Number(m[1])));
      const mm = Math.max(0, Math.min(59, Number(m[2])));
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }

  // 13時 / 13時半 / 13時15分
  {
    const m = /(\d{1,2})\s*時\s*(半|(\d{1,2})\s*分)?/.exec(s);
    if (m) {
      const hh = Math.max(0, Math.min(23, Number(m[1])));
      const mm = m[2] === '半' ? 30 : (m[3] ? Math.max(0, Math.min(59, Number(m[3]))) : 0);
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
  }

  return '';
};

const parseDateStr = ({ text, baseDate }) => {
  const s = normalizeText(text);
  const base = baseDate instanceof Date ? baseDate : new Date();

  if (!s) return '';

  if (s.includes('今日')) return toDateStrLocal(base);
  if (s.includes('明日')) {
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    return toDateStrLocal(d);
  }
  if (s.includes('明後日') || s.includes('あさって')) {
    const d = new Date(base);
    d.setDate(d.getDate() + 2);
    return toDateStrLocal(d);
  }

  // YYYY-MM-DD
  {
    const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }

  // M/D or M月D日 (year from base)
  {
    const m = /(\d{1,2})\s*[/月]\s*(\d{1,2})\s*(日)?/.exec(s);
    if (m) {
      const y = base.getFullYear();
      const mm = String(Math.max(1, Math.min(12, Number(m[1])))).padStart(2, '0');
      const dd = String(Math.max(1, Math.min(31, Number(m[2])))).padStart(2, '0');
      return `${y}-${mm}-${dd}`;
    }
  }

  return '';
};

const extractQuotedTitle = (text) => {
  const s = normalizeText(text);
  if (!s) return '';
  const m = /[「『](.+?)[」』]/.exec(s);
  return m ? normalizeText(m[1]) : '';
};

const buildLocalAssistantResponse = async ({ userText, schedules, selectedDate }) => {
  const text = normalizeText(userText);
  const baseDate = selectedDate instanceof Date ? selectedDate : new Date();
  const selectedDateStr = toDateStrLocal(baseDate);
  const list = Array.isArray(schedules) ? schedules : [];

  const lower = text.toLowerCase();
  const wantsSearch = text.includes('検索') || text.includes('探') || lower.includes('search');
  const wantsCreate = text.includes('追加') || text.includes('作成') || text.includes('入れ') || text.includes('登録');
  const wantsUpdate = text.includes('変更') || text.includes('リスケ') || text.includes('移動') || text.includes('ずら');
  const wantsView = text.includes('一覧') || text.includes('表示') || text.includes('見せ') || text.includes('見る');

  const isTask = text.includes('タスク');

  if (wantsSearch) {
    const keyword = normalizeText(text.replace(/(予定|タスク)?(を)?(検索|探(す|して|したい)?)/g, '').trim());
    const needle = (keyword || text).toLowerCase();
    const filtered = list
      .filter((s) => {
        const name = String(s?.name ?? '').toLowerCase();
        const memo = String(s?.memo ?? '').toLowerCase();
        return name.includes(needle) || memo.includes(needle);
      })
      .slice(0, 20);

    if (filtered.length === 0) {
      return { text: `「${keyword || text}」に一致する予定/タスクは見つかりませんでした。`, actions: [] };
    }

    const lines = filtered.map((s) => `- ${formatScheduleLabel(s)}`).join('\n');
    return { text: `見つかった候補です（最大20件）:\n${lines}`, actions: [] };
  }

  if (wantsView && !wantsCreate && !wantsUpdate) {
    const day = parseDateStr({ text, baseDate }) || selectedDateStr;
    const dayItems = list
      .filter((s) => String(s?.date ?? '') === day)
      .sort((a, b) => String(a?.time ?? '').localeCompare(String(b?.time ?? '')));

    if (dayItems.length === 0) {
      return { text: `${day} の予定/タスクはありません。`, actions: [] };
    }

    const lines = dayItems.map((s) => `- ${formatScheduleLabel(s)}`).join('\n');
    return { text: `${day} の予定/タスクです:\n${lines}`, actions: [] };
  }

  if (wantsCreate) {
    const date = parseDateStr({ text, baseDate }) || selectedDateStr;
    const time = parseTimeToHHMM(text);
    const title = extractQuotedTitle(text) || '';

    if (!title) {
      return {
        text: '追加する予定/タスクのタイトルが分かりません。例: 「ミーティング」を明日15時に追加',
        actions: [],
      };
    }

    const payload = {
      date,
      time: time || '',
      name: title,
      memo: '',
      allDay: !time,
      isTask,
      completed: false,
    };

    return {
      text: '以下の内容で追加提案を作りました。内容がOKなら「最終確認」→「実行」で反映します。',
      actions: [
        {
          id: makeId(),
          kind: 'create',
          title: isTask ? 'タスクを作成' : '予定を作成',
          summary: formatScheduleLabel(payload),
          payload,
        },
      ],
    };
  }

  if (wantsUpdate) {
    const nextDate = parseDateStr({ text, baseDate });
    const nextTime = parseTimeToHHMM(text);

    const title = extractQuotedTitle(text);
    const keyword = title || normalizeText(text.replace(/(予定|タスク|を|の|日程|時間|変更|リスケ|移動|ずら(す|して)?)/g, ' '));
    const needle = keyword.toLowerCase();

    const candidates = list.filter((s) => {
      const name = String(s?.name ?? '').toLowerCase();
      return needle && name.includes(needle);
    });

    if (candidates.length === 0) {
      return { text: '変更対象が特定できませんでした。変更したい予定/タスク名を「」で囲って教えてください。', actions: [] };
    }

    if (candidates.length > 1) {
      const lines = candidates.slice(0, 10).map((s) => `- ${formatScheduleLabel(s)}`).join('\n');
      return { text: `候補が複数あります。どれを変更しますか？\n${lines}`, actions: [] };
    }

    const target = candidates[0];
    const patch = {
      id: target.id,
      date: nextDate || target.date,
      time: nextTime || target.time || '',
      name: target.name,
      memo: target.memo || '',
      allDay: !(nextTime || target.time),
      isTask: !!target.isTask,
      completed: !!target.completed,
    };

    if (!nextDate && !nextTime) {
      return { text: '変更後の日時が分かりません。例: 「ミーティング」を明日15時に変更', actions: [] };
    }

    return {
      text: '以下の内容で変更提案を作りました。内容がOKなら「最終確認」→「実行」で反映します。',
      actions: [
        {
          id: makeId(),
          kind: 'update',
          title: patch.isTask ? 'タスクを変更' : '予定を変更',
          summary: `${formatScheduleLabel(target)} → ${formatScheduleLabel(patch)}`,
          payload: patch,
        },
      ],
    };
  }

  // default: helpful answer + quick view
  const todayItems = list
    .filter((s) => String(s?.date ?? '') === selectedDateStr)
    .slice(0, 5)
    .map((s) => `- ${formatScheduleLabel(s)}`)
    .join('\n');

  const hint = 'できること: 予定/タスクの閲覧・検索・作成・変更（実行前に必ず最終確認を挟みます）。\n例: 「支払い」を検索 / 「面談」を明日15時に追加 / 「ミーティング」を明日15時に変更';
  const extra = todayItems ? `\n\n${selectedDateStr} の予定/タスク（先頭5件）:\n${todayItems}` : '';
  return { text: `${hint}${extra}`, actions: [] };
};

const callOpenAiChatCompletions = async ({ apiKey, modelName, userText, selectedDateStr }) => {
  const system = [
    'あなたはスケジュール帳アプリのAIコンシェルジュです。',
    'ユーザーの要望を理解し、必要なら「提案」を作りますが、実行はしません（必ず最終確認が必要）。',
    '出力は必ず JSON のみで返してください。',
    'JSON形式: {"text": string, "actions": Array }',
    'actions は提案がある時だけ。各要素は:',
    '{"id": string, "kind": "create"|"update", "title": string, "summary": string, "payload": object}',
    'payload(create): {"date":"YYYY-MM-DD","time":"HH:MM"|"", "name":string,"memo":string,"allDay":boolean,"isTask":boolean,"completed":boolean}',
    'payload(update): 上記に加えて必ず "id" を含める（既存予定/タスクのIDが必要）。',
    'ユーザーが情報不足の場合は、実行提案を作らず質問して補完する。',
  ].join('\n');

  const body = {
    model: modelName,
    messages: [
      { role: 'system', content: system },
      { role: 'system', content: `selectedDate: ${selectedDateStr || ''}` },
      { role: 'user', content: userText },
    ],
    temperature: 0.2,
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = normalizeText(data?.error?.message) || `OpenAI API error: ${res.status}`;
    throw new Error(msg);
  }

  const content = normalizeText(data?.choices?.[0]?.message?.content);
  if (!content) {
    return { text: '（AIの応答が空でした）', actions: [] };
  }

  try {
    const parsed = JSON.parse(content);
    return {
      text: normalizeText(parsed?.text) || content,
      actions: Array.isArray(parsed?.actions) ? parsed.actions : [],
    };
  } catch {
    return { text: content, actions: [] };
  }
};

function AiConciergeModal({
  isOpen,
  onClose,
  selectedDate,
  selectedDateStr,
  schedules,
  onNavigateToDate,
  onSearchSchedules,
  onSaveSchedule,
  modelName = 'gpt-5.2',
}) {
  const inputRef = useRef(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(() => [
    {
      id: makeId(),
      role: 'assistant',
      text: 'AIコンシェルジュです。予定/タスクについて質問したり、追加/変更の提案を出せます（実行は必ず最終確認のあと）。',
      actions: [],
    },
  ]);

  const [sending, setSending] = useState(false);
  const [pendingAction, setPendingAction] = useState(null); // action
  const [errorText, setErrorText] = useState('');

  const list = useMemo(() => (Array.isArray(schedules) ? schedules : []), [schedules]);
  const safeSelectedDateStr = normalizeText(selectedDateStr) || (selectedDate instanceof Date ? toDateStrLocal(selectedDate) : '');

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus?.();
    }, 0);
    return () => window.clearTimeout(t);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (pendingAction) {
          setPendingAction(null);
          return;
        }
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, pendingAction]);

  const appendMessage = useCallback((msg) => {
    setMessages((prev) => {
      const base = Array.isArray(prev) ? prev : [];
      return [...base, msg];
    });
  }, []);

  const runAssistant = useCallback(async (userText) => {
    const endpoint = normalizeText(import.meta.env?.VITE_AI_CONCIERGE_ENDPOINT);
    const apiKey = getSavedAiApiKey();

    // Remote (optional)
    if (endpoint) {
      const payload = {
        model: modelName,
        messages: [
          ...messages.map((m) => ({ role: m.role, content: m.text })),
          { role: 'user', content: userText },
        ],
        context: {
          selectedDate: safeSelectedDateStr,
        },
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `AI endpoint error: ${res.status}`);
      }

      return {
        text: normalizeText(data?.text) || '（AIの応答が空でした）',
        actions: Array.isArray(data?.actions) ? data.actions : [],
      };
    }

    // Direct OpenAI (optional; key stored in browser)
    if (apiKey) {
      return await callOpenAiChatCompletions({
        apiKey,
        modelName,
        userText,
        selectedDateStr: safeSelectedDateStr,
      });
    }

    // Local fallback
    return await buildLocalAssistantResponse({ userText, schedules: list, selectedDate });
  }, [list, messages, modelName, safeSelectedDateStr, selectedDate]);

  const handleSend = useCallback(async () => {
    if (sending) return;
    const userText = normalizeText(input);
    if (!userText) return;

    setErrorText('');
    setSending(true);
    setInput('');

    appendMessage({ id: makeId(), role: 'user', text: userText, actions: [] });

    try {
      // If user asks to jump to date like 2026-01-07
      const maybeDate = parseDateStr({ text: userText, baseDate: selectedDate });
      if (maybeDate && userText.includes('移動')) {
        const d = fromDateStrLocal(maybeDate);
        if (d) {
          onNavigateToDate?.(d);
        }
      }

      // Prefer server-side search when available
      if (onSearchSchedules && (userText.includes('検索') || userText.includes('探'))) {
        const keyword = normalizeText(userText.replace(/(予定|タスク)?(を)?(検索|探(す|して|したい)?)/g, '').trim());
        if (keyword) {
          const results = await onSearchSchedules(keyword);
          const lines = (Array.isArray(results) ? results : []).slice(0, 20).map((s) => `- ${formatScheduleLabel(s)}`).join('\n');
          appendMessage({
            id: makeId(),
            role: 'assistant',
            text: lines ? `見つかった候補です（最大20件）:\n${lines}` : `「${keyword}」に一致する予定/タスクは見つかりませんでした。`,
            actions: [],
          });
          return;
        }
      }

      const { text: replyText, actions } = await runAssistant(userText);
      appendMessage({
        id: makeId(),
        role: 'assistant',
        text: replyText,
        actions: Array.isArray(actions) ? actions : [],
      });
    } catch (err) {
      setErrorText(err?.message || 'AIの処理に失敗しました。');
    } finally {
      setSending(false);
    }
  }, [appendMessage, input, onNavigateToDate, onSearchSchedules, runAssistant, selectedDate, sending]);

  const startReviewAction = useCallback((action) => {
    if (!action) return;
    setPendingAction(action);
  }, []);

  const cancelPending = useCallback(() => {
    setPendingAction(null);
  }, []);

  const executePending = useCallback(async () => {
    const action = pendingAction;
    if (!action) return;

    if (action.kind !== 'create' && action.kind !== 'update') {
      setPendingAction(null);
      return;
    }

    if (!onSaveSchedule) {
      setErrorText('保存ハンドラが未設定です。');
      return;
    }

    setErrorText('');
    setSending(true);
    try {
      await onSaveSchedule(action.payload);
      appendMessage({
        id: makeId(),
        role: 'assistant',
        text: `実行しました: ${normalizeText(action?.title) || '更新'}\n- ${formatScheduleLabel(action.payload)}`,
        actions: [],
      });
      setPendingAction(null);
    } catch (err) {
      setErrorText(err?.message || '実行に失敗しました。');
    } finally {
      setSending(false);
    }
  }, [appendMessage, onSaveSchedule, pendingAction]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10030] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="AIコンシェルジュ"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gray-100 text-[11px] font-bold text-gray-700" aria-hidden="true">AI</span>
            AIコンシェルジュ
            <span className="ml-2 text-[11px] font-normal text-gray-500">model: {modelName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            aria-label="閉じる"
            title="閉じる"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="text-xs text-gray-600">
            現在の日付: <span className="font-semibold text-gray-800">{safeSelectedDateStr || '未選択'}</span>
          </div>

          <div className="mt-3 grid grid-rows-[1fr_auto] gap-3" style={{ height: 'min(65vh, 560px)' }}>
            <div className="custom-scrollbar overflow-y-auto rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-col gap-3">
                {messages.map((m) => {
                  const isUser = m.role === 'user';
                  return (
                    <div key={m.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${isUser ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-800'}`}>
                        <div className="whitespace-pre-wrap break-words">{m.text}</div>
                        {!isUser && Array.isArray(m.actions) && m.actions.length > 0 && (
                          <div className="mt-2 flex flex-col gap-2">
                            {m.actions.map((a) => (
                              <div key={a.id || makeId()} className="rounded-md border border-gray-200 bg-white p-2">
                                <div className="text-xs font-semibold text-gray-800">{normalizeText(a.title) || '提案'}</div>
                                {a.summary && <div className="mt-0.5 text-xs text-gray-600 whitespace-pre-wrap">{a.summary}</div>}
                                <div className="mt-2">
                                  <button
                                    type="button"
                                    onClick={() => startReviewAction(a)}
                                    className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                                  >
                                    最終確認へ
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {pendingAction ? (
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                <div className="text-sm font-semibold text-indigo-900">最終確認</div>
                <div className="mt-1 text-xs text-indigo-900/80">
                  実行前に内容を確認してください（この確認をスキップして実行しません）。
                </div>
                <div className="mt-2 rounded-md border border-indigo-200 bg-white p-2">
                  <div className="text-xs font-semibold text-gray-800">{normalizeText(pendingAction?.title) || '操作'}</div>
                  <div className="mt-1 text-xs text-gray-700 whitespace-pre-wrap">{pendingAction?.summary || formatScheduleLabel(pendingAction?.payload)}</div>
                </div>

                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelPending}
                    className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                    disabled={sending}
                  >
                    キャンセル
                  </button>
                  <button
                    type="button"
                    onClick={executePending}
                    className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                    disabled={sending}
                  >
                    {sending ? '実行中…' : '最終確認して実行'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="例: 「ミーティング」を明日15時に追加 / 「支払い」を検索"
                  className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend().catch(() => {});
                    }
                  }}
                  disabled={sending}
                />
                <button
                  type="button"
                  onClick={() => handleSend().catch(() => {})}
                  className="inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 disabled:opacity-60"
                  disabled={sending || !normalizeText(input)}
                >
                  送信
                </button>
              </div>
            )}

            {errorText && (
              <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {errorText}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default AiConciergeModal;
