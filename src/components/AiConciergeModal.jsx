import { supabase } from '../lib/supabaseClient';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fromDateStrLocal, toDateStrLocal } from '../utils/date';
import { createTempId } from '../utils/id';

const makeId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const normalizeText = (v) => (typeof v === 'string' ? v.trim() : '');

const MAX_NOTIFICATIONS = 3;

const normalizeNotificationUnit = (rawUnit) => {
  const u = normalizeText(rawUnit).toLowerCase();
  if (!u) return '';
  if (u === 'minutes' || u === 'minute' || u === 'min' || u === 'mins') return 'minutes';
  if (u === 'hours' || u === 'hour' || u === 'hr' || u === 'hrs') return 'hours';
  if (u === 'days' || u === 'day') return 'days';
  if (u === '分' || u.includes('分')) return 'minutes';
  if (u === '時間' || u.includes('時間')) return 'hours';
  if (u === '日' || u.includes('日')) return 'days';
  return '';
};

const sanitizeNotificationsInput = ({ notifications, allDay, time }) => {
  const list = Array.isArray(notifications) ? notifications : [];
  const isAllDay = !!allDay || !normalizeText(time);
  const sanitized = [];

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;

    const valueRaw = raw.value;
    const unit = normalizeNotificationUnit(raw.unit);
    if (!unit) continue;

    const num = Number(valueRaw);
    if (!Number.isFinite(num)) continue;
    const value = Math.max(0, Math.min(3650, Math.trunc(num)));

    if (isAllDay) {
      // 終日は days のみ（ScheduleFormの補正方針に寄せる）
      sanitized.push({ value: unit === 'days' ? value : 0, unit: 'days' });
    } else {
      sanitized.push({ value, unit });
    }

    if (sanitized.length >= MAX_NOTIFICATIONS) break;
  }

  return sanitized;
};

const isValidDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(normalizeText(s));
const isValidTimeStr = (s) => /^\d{2}:\d{2}$/.test(normalizeText(s));

const parseDateStrToNoonLocal = (dateStr) => {
  const parts = String(dateStr || '').split('-').map((v) => Number(v));
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
};

const addDaysToDateStr = (dateStr, deltaDays) => {
  const base = parseDateStrToNoonLocal(dateStr);
  if (!base) return null;
  const next = new Date(base);
  next.setDate(next.getDate() + Number(deltaDays || 0));
  return toDateStrLocal(next);
};

const sanitizeBulkPayload = ({ payload, schedules }) => {
  const p = payload && typeof payload === 'object' ? payload : null;
  if (!p) return null;

  const operationRaw = normalizeText(p.operation);
  const operation = operationRaw === 'aggregate' || operationRaw === 'relative' ? operationRaw : null;
  const actionRaw = normalizeText(p.action);
  const action = actionRaw === 'move' || actionRaw === 'copy' ? actionRaw : null;
  const targetDate = normalizeText(p.targetDate);
  if (!operation || !action || !isValidDateStr(targetDate)) return null;

  const idsRaw = Array.isArray(p.ids) ? p.ids : [];
  const ids = idsRaw.map((v) => normalizeText(v)).filter(Boolean);
  if (ids.length === 0) return null;

  const baseId = normalizeText(p.baseId);
  if (operation === 'relative') {
    if (!baseId) return null;
    if (!ids.includes(baseId)) return null;
    const base = (Array.isArray(schedules) ? schedules : []).find((s) => String(s?.id ?? '') === String(baseId));
    const baseDate = normalizeText(base?.date);
    if (!isValidDateStr(baseDate)) return null;
  }

  return { operation, action, targetDate, ids, baseId: baseId || '' };
};

const sanitizeSchedulePayload = ({ kind, payload, fallbackDateStr } = {}) => {
  const p = payload && typeof payload === 'object' ? payload : {};
  const safeKind = kind === 'create' || kind === 'update' ? kind : null;
  if (!safeKind) return null;

  const has = (key) => Object.prototype.hasOwnProperty.call(p, key);
  const out = {};

  if (safeKind === 'update') {
    const id = normalizeText(p.id);
    if (!id) return null;
    out.id = id;
  }

  // date
  if (safeKind === 'create') {
    const d = normalizeText(p.date);
    out.date = isValidDateStr(d) ? d : (isValidDateStr(fallbackDateStr) ? fallbackDateStr : '');
  } else if (has('date')) {
    const d = normalizeText(p.date);
    if (isValidDateStr(d)) out.date = d;
  }

  // time / allDay
  if (safeKind === 'create') {
    const t = normalizeText(p.time);
    out.time = isValidTimeStr(t) ? t : '';
    const allDay = has('allDay') ? !!p.allDay : !out.time;
    out.allDay = !!allDay;
    if (out.allDay) out.time = '';
  } else {
    const maybeTime = has('time') ? normalizeText(p.time) : '';
    const timeOk = maybeTime && isValidTimeStr(maybeTime);
    if (has('time')) {
      out.time = timeOk ? maybeTime : '';
    }
    if (has('allDay')) {
      out.allDay = !!p.allDay;
      if (out.allDay) out.time = '';
    }
  }

  // name
  if (safeKind === 'create') {
    out.name = normalizeText(p.name);
  } else if (has('name')) {
    out.name = normalizeText(p.name);
  }

  // memo
  if (safeKind === 'create') {
    out.memo = typeof p.memo === 'string' ? p.memo : '';
  } else if (has('memo')) {
    out.memo = typeof p.memo === 'string' ? p.memo : '';
  }

  // flags
  if (safeKind === 'create') {
    out.isTask = !!p.isTask;
    out.completed = !!p.completed;
    out.isDeadlineTask = !!p.isDeadlineTask;
  } else {
    if (has('isTask')) out.isTask = !!p.isTask;
    if (has('completed')) out.completed = !!p.completed;
    if (has('isDeadlineTask')) out.isDeadlineTask = !!p.isDeadlineTask;
  }

  // notifications
  if (safeKind === 'create' || has('notifications')) {
    const allDay = has('allDay') ? !!p.allDay : (safeKind === 'create' ? !!out.allDay : false);
    const time = has('time') ? normalizeText(p.time) : (safeKind === 'create' ? out.time : '');
    out.notifications = sanitizeNotificationsInput({ notifications: p.notifications, allDay, time });
  }

  return out;
};

const compareDateTime = (a, b) => {
  const ad = normalizeText(a?.date);
  const bd = normalizeText(b?.date);
  const dc = ad.localeCompare(bd);
  if (dc !== 0) return dc;
  const at = normalizeText(a?.time);
  const bt = normalizeText(b?.time);
  return at.localeCompare(bt);
};

const buildAiTaskListContext = ({ schedules, taskSchedules, baseDateStr }) => {
  const merged = [];

  const pushAll = (items) => {
    const list = Array.isArray(items) ? items : [];
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      if (!raw?.isTask) continue;

      const id = normalizeText(raw?.id);
      const date = normalizeText(raw?.date);
      if (!id || !isValidDateStr(date)) continue;

      const timeRaw = normalizeText(raw?.time);
      const time = isValidTimeStr(timeRaw) ? timeRaw : '';
      const allDay = !!raw?.allDay || !time;

      merged.push({
        id,
        date,
        time,
        allDay,
        name: normalizeText(raw?.name),
        completed: !!raw?.completed,
        isDeadlineTask: !!raw?.isDeadlineTask,
      });
    }
  };

  pushAll(schedules);
  pushAll(taskSchedules);

  const uniq = new Map();
  for (const t of merged) {
    if (!uniq.has(t.id)) uniq.set(t.id, t);
  }

  const base = isValidDateStr(baseDateStr) ? baseDateStr : '';
  const all = Array.from(uniq.values()).sort(compareDateTime);
  const upcoming = base ? all.filter((t) => t.date >= base) : all;
  const past = base ? all.filter((t) => t.date < base) : [];

  return {
    baseDate: base,
    upcomingDeadlineTasks: upcoming.filter((t) => t.isDeadlineTask && !t.completed).slice(0, 50),
    upcomingTasks: upcoming.filter((t) => !t.completed).slice(0, 80),
    recentTasks: past.filter((t) => !t.completed).slice(-20),
  };
};

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
  const isDeadlineTask = !!item?.isDeadlineTask;
  const kind = isTask ? (completed ? 'タスク(完了)' : (isDeadlineTask ? '納期タスク' : 'タスク')) : '予定';
  const head = [date, time].filter(Boolean).join(' ');
  return `${name}（${[head, kind].filter(Boolean).join(' / ')}）`;
};

const isUpdateIntent = (text) => {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    t.includes('変更') ||
    t.includes('編集') ||
    t.includes('更新') ||
    t.includes('リスケ') ||
    t.includes('移動') ||
    t.includes('ずら') ||
    t.includes('メモ') ||
    t.includes('通知')
  );
};

const isDeleteIntent = (text) => {
  const t = normalizeText(text);
  if (!t) return false;
  return (
    t.includes('削除') ||
    t.includes('消し') ||
    t.includes('消す') ||
    t.includes('取り消') ||
    t.includes('取消') ||
    t.includes('キャンセル') ||
    t.includes('なくな')
  );
};

const parseTimeFilter = (text) => {
  const s = normalizeText(text);
  if (!s) return null;

  // explicit HH:MM
  {
    const t = parseTimeToHHMM(s);
    if (t && (s.includes(':') || s.includes('：') || /\d{1,2}\s*[:：]\s*\d{2}/.test(s))) {
      return { mode: 'exact', value: t };
    }
  }

  // hour-only like 10時
  {
    const m = /(\d{1,2})\s*時(?!\s*(\d{1,2})\s*分|\s*[:：]\s*\d{2})/.exec(s);
    if (m) {
      const hh = Math.max(0, Math.min(23, Number(m[1])));
      return { mode: 'hour', value: String(hh).padStart(2, '0') };
    }
  }

  // generic (falls back)
  {
    const t = parseTimeToHHMM(s);
    if (t) return { mode: 'exact', value: t };
  }

  return null;
};

const buildTargetCandidates = ({ userText, schedules, baseDate }) => {
  const text = normalizeText(userText);
  const list = Array.isArray(schedules) ? schedules : [];
  const quoted = extractQuotedTitle(text);
  const keyword = quoted || normalizeText(text.replace(/(予定|タスク|を|の|日程|時間|変更|編集|更新|リスケ|移動|ずら(す|して)?|削除|消(し|す)|取り消(し)?|取消|キャンセル|なくな(っ|り)?た|中止|延期|メモ|通知)/g, ' '));
  const needle = keyword.toLowerCase();
  if (!needle) return [];

  const base = baseDate instanceof Date ? baseDate : new Date();
  const dateFilter = parseDateStr({ text, baseDate: base });
  const timeFilter = parseTimeFilter(text);

  const keywordMatches = list.filter((s) => String(s?.name ?? '').toLowerCase().includes(needle));

  const applyDateTime = (items) => {
    let filtered = Array.isArray(items) ? items : [];
    if (dateFilter) {
      filtered = filtered.filter((s) => normalizeText(s?.date) === dateFilter);
    }
    if (timeFilter?.mode === 'exact') {
      filtered = filtered.filter((s) => normalizeText(s?.time) === timeFilter.value);
    } else if (timeFilter?.mode === 'hour') {
      filtered = filtered.filter((s) => normalizeText(s?.time).startsWith(`${timeFilter.value}:`));
    }
    return filtered;
  };

  const strict = applyDateTime(keywordMatches);
  const picked = strict.length > 0 ? strict : keywordMatches;

  return picked.slice(0, 10);
};

const buildAiConciergeSystemText = () => [
  'あなたはスケジュール帳アプリのAIコンシェルジュです。',
  'あなたは「提案」まで行い、実行はしません（UIで必ず最終確認→実行ボタンが必要）。',
  '',
  'できること:',
  '- 閲覧: 今日/指定日の予定・タスクの一覧を出す（必要なら質問する）',
  '- 検索: キーワードで候補を探す（必要なら条件を確認する）',
  '- 作成: 予定/タスクを新規作成する提案を出す',
  '- 変更: 既存の予定/タスクを編集する提案を出す（ただしIDが不明なら update は提案しない）',
  '- 削除(取消): 既存の予定/タスクを削除する提案を出す（ただしIDが不明なら delete は提案しない）',
  '',
  'データ構造（payload）:',
  '- date: "YYYY-MM-DD"',
  '- time: "HH:MM" もしくは ""（終日）',
  '- allDay: boolean（終日のとき true）',
  '- name: タイトル',
  '- memo: メモ（文字列）',
  '- notifications: Array<{value:number, unit:"minutes"|"hours"|"days"}>（最大3件）',
  '  - 終日(allDay=true または time="") のとき unit は "days" のみにする',
  '- isTask: boolean（タスクかどうか）',
  '- completed: boolean（タスク完了）',
  '- isDeadlineTask: boolean（納期タスク）',
  '',
  '出力ルール:',
  '- 出力は必ず JSON のみ',
  '- JSON形式: {"text": string, "actions": Array}',
  '- actions の各要素: {"id": string, "kind": "create"|"update"|"delete"|"bulk", "title": string, "summary": string, "payload": object}',
  '- create payload: {date,time,name,memo,notifications,allDay,isTask,completed}',
  '- update payload: 上記 + 必ず id',
  '- delete payload: {id} のみ',
  '- bulk payload: {operation:"aggregate"|"relative", action:"move"|"copy", ids:string[], targetDate:"YYYY-MM-DD", baseId?:string}',
  '- 情報が足りない場合は actions を空にして質問する（例: 日付/時刻/タイトルの確認）',
  '',
  '重要: ユーザーの最終決定が前提なので、断定できない場合は候補の確認質問を優先する。',
  '',
  '複数件の一括操作（Volt相当）:',
  '- ユーザーが「Voltを使って」と明示しなくても、意図が複数件の集約/相対移動/コピーなら actions を複数件まとめて提案してよい。',
  '- 集約（aggregate）: 対象の date をすべて同じ targetDate にそろえる（time は原則維持、終日は allDay=true/time="" を維持）。',
  '- 相対（relative）: 基準となる1件（ドラッグした想定の1件）の date 変化量（deltaDays）を推定し、他の対象にも同じ deltaDays を加える。',
  '- コピー（copy）: 元を残して複製を作る（create）。コピー時は通知を複製しない（notifications: [] を基本）。',
  '- 対象が曖昧な場合は actions を空にして、対象（タイトル/期間/件数）と基準（どれを基準に相対移動するか）を質問する。',
  '',
  '補足:',
  '- system/context に taskList（タスク一覧）が渡される場合がある。直近の納期タスク等は taskList を優先して回答する。',
  '- system/context に search（検索結果）が渡される場合がある。候補の列挙/絞り込み/確認質問に活用する。',
].join('\n');

const sanitizeActions = (raw) => {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .map((a) => (a && typeof a === 'object' ? a : null))
    .filter(Boolean)
    .map((a) => {
      const kind = a.kind === 'create' || a.kind === 'update' || a.kind === 'delete' || a.kind === 'selectTarget' || a.kind === 'bulk' ? a.kind : null;
      if (!kind) return null;
      const payload = a.payload && typeof a.payload === 'object' ? a.payload : null;
      if (!payload) return null;

      let sanitizedPayload;
      if (kind === 'create' || kind === 'update') {
        sanitizedPayload = sanitizeSchedulePayload({ kind, payload });
        if (!sanitizedPayload) return null;
      } else if (kind === 'bulk') {
        // bulk は「提案」→「最終確認」時に schedules と合わせて検証する
        sanitizedPayload = payload;
      } else {
        const id = normalizeText(payload.id);
        if (!id) return null;
        sanitizedPayload = { id };
      }

      return {
        id: normalizeText(a.id) || makeId(),
        kind,
        title: normalizeText(a.title) || (kind === 'create' ? '作成' : kind === 'delete' ? '削除（取り消し）' : '変更'),
        summary: normalizeText(a.summary),
        payload: sanitizedPayload,
      };
    })
    .filter(Boolean);
};

const extractMemoFromText = (text) => {
  const s = normalizeText(text);
  if (!s) return null;
  const quoted = /メモ\s*[「『](.+?)[」』]/.exec(s);
  if (quoted) return normalizeText(quoted[1]);
  const colon = /メモ\s*[:：]\s*([^\n]+)$/.exec(s);
  if (colon) return normalizeText(colon[1]);
  return null;
};

const parseNotificationsFromText = (text) => {
  const s = normalizeText(text);
  if (!s) return [];

  const out = [];

  if (s.includes('開始時刻') && (s.includes('通知') || s.includes('リマインド'))) {
    out.push({ value: 0, unit: 'minutes' });
  }

  const re = /(\d{1,4})\s*(分|時間|日)\s*前/g;
  let m;
  while ((m = re.exec(s)) != null) {
    const value = Number(m[1]);
    const unit = normalizeNotificationUnit(m[2]);
    if (!Number.isFinite(value) || !unit) continue;
    out.push({ value, unit });
    if (out.length >= MAX_NOTIFICATIONS) break;
  }

  return out;
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

const extractSearchKeyword = (text) => {
  const s = normalizeText(text);
  if (!s) return '';

  const quoted = extractQuotedTitle(s);
  if (quoted) return quoted;

  // rough heuristic: strip common helper phrases/particles
  const cleaned = normalizeText(
    s
      .replace(/(予定|タスク|メモ|通知|納期|締切|期限)/g, ' ')
      .replace(/(って|とは|ってさ|ってやつ|という|みたいな)/g, ' ')
      .replace(/(いつ|どこ|なに|何|どれ|教えて|知りたい|確認|探して|探す|検索|見つけて|見つける|ある\?|ありますか|ある|ない)/g, ' ')
      .replace(/(です|ます|だっけ|かな|ね|よ|を|の|が|は|に|へ|で|と|や|も|から|まで)/g, ' ')
      .replace(/\s+/g, ' ')
  );

  // avoid dates/times as keywords
  if (!cleaned) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return '';
  if (/^\d{1,2}[:：]\d{2}$/.test(cleaned)) return '';

  // prefer first chunk (keep it short)
  const first = normalizeText(cleaned.split(' ')[0] || '');
  if (first.length < 2) return '';
  if (first.length > 30) return first.slice(0, 30);
  return first;
};

const shouldIncludeTaskList = (text) => {
  const s = normalizeText(text);
  if (!s) return false;

  // "納期/期限/締切" 系や、未完了・直近などの質問はタスク一覧があると強い
  const deadlineish = /(納期|期限|締切|〆切|デッドライン|支払期限|提出期限)/.test(s);
  const statusish = /(未完了|未済|残り|残って|やり残し|完了(して)?(ない|未)|終わってない)/.test(s);
  const listish = /(一覧|リスト|全部|全て|すべて|まとめて|一括|複数|まとめ|直近|近い|近々)/.test(s);
  const taskish = /タスク/.test(s);
  const dueSoon = /(今日|明日|今週|今月)/.test(s) && (taskish || deadlineish || listish);

  return deadlineish || statusish || (taskish && listish) || dueSoon;
};

const buildLocalAssistantResponse = async ({ userText, schedules, selectedDate, targetSchedule }) => {
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
    const memo = extractMemoFromText(text);
    const notificationsRaw = parseNotificationsFromText(text);

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
      memo: memo ?? '',
      allDay: !time,
      isTask,
      completed: false,
      notifications: sanitizeNotificationsInput({ notifications: notificationsRaw, allDay: !time, time: time || '' }),
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
    if (targetSchedule?.id) {
      const nextDate = parseDateStr({ text, baseDate });
      const nextTime = parseTimeToHHMM(text);
      const nextMemo = extractMemoFromText(text);
      const notificationsRaw = parseNotificationsFromText(text);
      const hasNotifUpdate = Array.isArray(notificationsRaw) && notificationsRaw.length > 0;

      if (!nextDate && !nextTime && nextMemo == null && !hasNotifUpdate) {
        return { text: '変更内容が分かりません。例: 「ミーティング」を明日15時に変更 / メモを「議題はA/B」に変更 / 10分前に通知', actions: [] };
      }

      const patch = {
        id: targetSchedule.id,
        date: nextDate || targetSchedule.date,
        time: nextTime || targetSchedule.time || '',
        name: targetSchedule.name,
        memo: nextMemo != null ? nextMemo : (targetSchedule.memo || ''),
        allDay: !(nextTime || targetSchedule.time),
        isTask: !!targetSchedule.isTask,
        completed: !!targetSchedule.completed,
        notifications: hasNotifUpdate
          ? sanitizeNotificationsInput({ notifications: notificationsRaw, allDay: !(nextTime || targetSchedule.time), time: nextTime || targetSchedule.time || '' })
          : (Array.isArray(targetSchedule.notifications) ? targetSchedule.notifications : []),
      };

      return {
        text: '以下の内容で変更提案を作りました。内容がOKなら「最終確認」→「実行」で反映します。',
        actions: [
          {
            id: makeId(),
            kind: 'update',
            title: patch.isTask ? 'タスクを変更' : '予定を変更',
            summary: `${formatScheduleLabel(targetSchedule)} → ${formatScheduleLabel(patch)}`,
            payload: patch,
          },
        ],
      };
    }

    const nextDate = parseDateStr({ text, baseDate });
    const nextTime = parseTimeToHHMM(text);
    const nextMemo = extractMemoFromText(text);
    const notificationsRaw = parseNotificationsFromText(text);
    const hasNotifUpdate = Array.isArray(notificationsRaw) && notificationsRaw.length > 0;

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
      memo: nextMemo != null ? nextMemo : (target.memo || ''),
      allDay: !(nextTime || target.time),
      isTask: !!target.isTask,
      completed: !!target.completed,
      notifications: hasNotifUpdate
        ? sanitizeNotificationsInput({ notifications: notificationsRaw, allDay: !(nextTime || target.time), time: nextTime || target.time || '' })
        : (Array.isArray(target.notifications) ? target.notifications : []),
    };

    if (!nextDate && !nextTime && nextMemo == null && !hasNotifUpdate) {
      return { text: '変更内容が分かりません。例: 「ミーティング」を明日15時に変更 / メモを「議題はA/B」に変更 / 10分前に通知', actions: [] };
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

const callOpenAiChatCompletions = async ({ apiKey, modelName, userText, selectedDateStr, targetSchedule, taskListContext, searchContext }) => {
  const system = [
    buildAiConciergeSystemText(),
    '',
    '追加の注意:',
    '- delete/update は id が必要。id が不明なら actions は出さず、追加情報（タイトル/日付/時刻）を質問する。',
  ].join('\n');

  const target = targetSchedule && typeof targetSchedule === 'object'
    ? {
      id: normalizeText(targetSchedule?.id),
      date: normalizeText(targetSchedule?.date),
      time: normalizeText(targetSchedule?.time),
      name: normalizeText(targetSchedule?.name),
      memo: normalizeText(targetSchedule?.memo),
      allDay: !!targetSchedule?.allDay,
      isTask: !!targetSchedule?.isTask,
      completed: !!targetSchedule?.completed,
    }
    : null;

  const body = {
    model: modelName,
    messages: [
      { role: 'system', content: system },
      { role: 'system', content: `selectedDate: ${selectedDateStr || ''}` },
      ...(taskListContext ? [{ role: 'system', content: `taskList: ${JSON.stringify(taskListContext)}` }] : []),
      ...(searchContext ? [{ role: 'system', content: `search: ${JSON.stringify(searchContext)}` }] : []),
      ...(target ? [{ role: 'system', content: `targetSchedule: ${JSON.stringify(target)}` }] : []),
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
  taskSchedules,
  onNavigateToDate,
  onSearchSchedules,
  onSaveSchedule,
  onDeleteSchedule,
  onScheduleUpdate,
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
  const [selectedUpdateTargetId, setSelectedUpdateTargetId] = useState(null);
  const [pendingTargetText, setPendingTargetText] = useState(null);
  const [pendingTargetKind, setPendingTargetKind] = useState(null); // 'update' | 'delete'

  const list = useMemo(() => (Array.isArray(schedules) ? schedules : []), [schedules]);
  const selectedUpdateTarget = useMemo(() => {
    if (!selectedUpdateTargetId) return null;
    return (Array.isArray(list) ? list : []).find((s) => String(s?.id ?? '') === String(selectedUpdateTargetId)) || null;
  }, [list, selectedUpdateTargetId]);
  const safeSelectedDateStr = normalizeText(selectedDateStr) || (selectedDate instanceof Date ? toDateStrLocal(selectedDate) : '');

  const taskListContext = useMemo(() => {
    return buildAiTaskListContext({ schedules: list, taskSchedules, baseDateStr: safeSelectedDateStr });
  }, [list, safeSelectedDateStr, taskSchedules]);

  const toAiScheduleRef = useCallback((raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const id = normalizeText(raw?.id);
    const date = normalizeText(raw?.date);
    if (!id || !isValidDateStr(date)) return null;
    const timeRaw = normalizeText(raw?.time);
    const time = isValidTimeStr(timeRaw) ? timeRaw : '';
    return {
      id,
      date,
      time,
      allDay: !!raw?.allDay || !time,
      name: normalizeText(raw?.name),
      memo: normalizeText(raw?.memo),
      notifications: Array.isArray(raw?.notifications) ? raw.notifications : [],
      isTask: !!raw?.isTask,
      completed: !!raw?.completed,
      isDeadlineTask: !!raw?.isDeadlineTask,
    };
  }, []);

  const toAiSearchRef = useCallback((raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const id = normalizeText(raw?.id);
    const date = normalizeText(raw?.date);
    if (!id || !isValidDateStr(date)) return null;
    const timeRaw = normalizeText(raw?.time);
    const time = isValidTimeStr(timeRaw) ? timeRaw : '';
    return {
      id,
      date,
      time,
      allDay: !!raw?.allDay || !time,
      name: normalizeText(raw?.name),
      isTask: !!raw?.isTask,
      completed: !!raw?.completed,
      isDeadlineTask: !!raw?.isDeadlineTask,
    };
  }, []);

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

  const runAssistant = useCallback(async (userText, options = {}) => {
    const endpointBase = normalizeText(import.meta.env?.VITE_AI_CONCIERGE_ENDPOINT);
    const endpoint = endpointBase
      ? (endpointBase.endsWith('/ai/chat') ? endpointBase : `${endpointBase.replace(/\/+$/, '')}/ai/chat`)
      : '';
    const apiKey = getSavedAiApiKey();
    const targetOverride = options?.targetSchedule && typeof options.targetSchedule === 'object' ? options.targetSchedule : null;
    const targetForCall = targetOverride || selectedUpdateTarget;
    const searchContext = options?.searchContext && typeof options.searchContext === 'object' ? options.searchContext : null;
    const includeTaskList = !!options?.forceTaskList || shouldIncludeTaskList(userText);

    // Remote (optional)
    if (endpoint) {
      const session = await supabase.auth.getSession();
      const accessToken = session?.data?.session?.access_token || '';

      const payload = {
        model: modelName,
        messages: [
          ...messages.map((m) => ({ role: m.role, content: m.text })),
          { role: 'user', content: userText },
        ],
        context: {
          selectedDate: safeSelectedDateStr,
          ...(includeTaskList ? { taskList: taskListContext } : {}),
          ...(searchContext ? { search: searchContext } : {}),
          schema: {
            schedule: {
              date: 'YYYY-MM-DD',
              time: 'HH:MM or ""',
              allDay: 'boolean',
              name: 'string',
              memo: 'string',
              notifications: 'Array<{value:number,unit:minutes|hours|days}> (max 3)',
              isTask: 'boolean',
              completed: 'boolean',
              isDeadlineTask: 'boolean',
            },
            actions: {
              create: 'payload: date,time,name,memo,notifications,allDay,isTask,completed',
              update: 'payload: id + above',
              delete: 'payload: {id}',
            },
            bulkOperations: {
              note: 'Volt相当: 複数件の集約(aggregate)/相対(relative)/コピー(copy)は、create/update を複数件並べて提案する。曖昧なら質問。コピー時は通知は複製しない（notifications: [] を基本）。',
            },
          },
          ...(targetForCall && targetForCall?.id
            ? {
              targetSchedule: {
                id: normalizeText(targetForCall?.id),
                date: normalizeText(targetForCall?.date),
                time: normalizeText(targetForCall?.time),
                name: normalizeText(targetForCall?.name),
                memo: normalizeText(targetForCall?.memo),
                allDay: !!targetForCall?.allDay,
                isTask: !!targetForCall?.isTask,
                completed: !!targetForCall?.completed,
                isDeadlineTask: !!targetForCall?.isDeadlineTask,
                notifications: Array.isArray(targetForCall?.notifications) ? targetForCall.notifications : [],
              },
            }
            : {}),
        },
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `AI endpoint error: ${res.status}`);
      }

      return {
        text: normalizeText(data?.text) || '（AIの応答が空でした）',
        actions: sanitizeActions(data?.actions),
      };
    }

    // Direct OpenAI (optional; key stored in browser)
    if (apiKey) {
      return await callOpenAiChatCompletions({
        apiKey,
        modelName,
        userText,
        selectedDateStr: safeSelectedDateStr,
        targetSchedule: targetForCall,
        taskListContext: includeTaskList ? taskListContext : null,
        searchContext,
      });
    }

    // Local fallback
    return await buildLocalAssistantResponse({ userText, schedules: list, selectedDate, targetSchedule: targetForCall });
  }, [list, messages, modelName, safeSelectedDateStr, selectedDate, selectedUpdateTarget, taskListContext]);

  const handleSend = useCallback(async () => {
    if (sending) return;
    const userText = normalizeText(input);
    if (!userText) return;

    setErrorText('');
    setSending(true);
    setInput('');

    appendMessage({ id: makeId(), role: 'user', text: userText, actions: [] });

    try {
      // Delete/cancel flow: pick target first (avoid "IDが必要" という会話にならないようにする)
      if (isDeleteIntent(userText) && !selectedUpdateTarget) {
        const candidates = buildTargetCandidates({ userText, schedules: list, baseDate: selectedDate });
        if (candidates.length === 0) {
          appendMessage({
            id: makeId(),
            role: 'assistant',
            text: 'どの予定/タスクを削除（取り消し）しますか？タイトルを「」で囲って教えてください。例: 「ミーティング」を削除',
            actions: [],
          });
          return;
        }

        if (candidates.length > 1) {
          setPendingTargetText(userText);
          setPendingTargetKind('delete');
          appendMessage({
            id: makeId(),
            role: 'assistant',
            text: 'どれを削除（取り消し）しますか？（まず1件だけ選んでください）',
            actions: sanitizeActions(
              candidates.map((s) => ({
                id: makeId(),
                kind: 'selectTarget',
                title: '削除対象にする',
                summary: formatScheduleLabel(s),
                payload: { id: s?.id ?? null },
              }))
            ),
          });
          return;
        }

        const target = candidates[0];
        setSelectedUpdateTargetId(target?.id ?? null);
        appendMessage({
          id: makeId(),
          role: 'assistant',
          text: '削除（取り消し）の提案を作りました。内容がOKなら「最終確認」→「実行」で反映します。',
          actions: sanitizeActions([
            {
              id: makeId(),
              kind: 'delete',
              title: target?.isTask ? 'タスクを削除（取り消し）' : '予定を削除（取り消し）',
              summary: formatScheduleLabel(target),
              payload: { id: target?.id },
            },
          ]),
        });
        return;
      }

      if (isDeleteIntent(userText) && selectedUpdateTarget?.id) {
        appendMessage({
          id: makeId(),
          role: 'assistant',
          text: '削除（取り消し）の提案を作りました。内容がOKなら「最終確認」→「実行」で反映します。',
          actions: sanitizeActions([
            {
              id: makeId(),
              kind: 'delete',
              title: selectedUpdateTarget?.isTask ? 'タスクを削除（取り消し）' : '予定を削除（取り消し）',
              summary: formatScheduleLabel(selectedUpdateTarget),
              payload: { id: selectedUpdateTarget?.id },
            },
          ]),
        });
        return;
      }

      // Stable update flow: pick target first (avoid AI guessing ids)
      if (isUpdateIntent(userText) && !selectedUpdateTarget) {
        const candidates = buildTargetCandidates({ userText, schedules: list, baseDate: selectedDate });
        if (candidates.length === 0) {
          appendMessage({
            id: makeId(),
            role: 'assistant',
            text: '変更対象が特定できませんでした。変更したい予定/タスク名を「」で囲って教えてください。例: 「ミーティング」を明日15時に変更',
            actions: [],
          });
          return;
        }

        if (candidates.length > 1) {
          setPendingTargetText(userText);
          setPendingTargetKind('update');
          appendMessage({
            id: makeId(),
            role: 'assistant',
            text: 'どれを変更しますか？（まず1件だけ選んでください）',
            actions: sanitizeActions(
              candidates.map((s) => ({
                id: makeId(),
                kind: 'selectTarget',
                title: '変更対象にする',
                summary: formatScheduleLabel(s),
                payload: { id: s?.id ?? null },
              }))
            ),
          });
          return;
        }

        const target = candidates[0];
        setSelectedUpdateTargetId(target?.id ?? null);
        const { text: replyText, actions } = await runAssistant(userText, { targetSchedule: target });
        appendMessage({
          id: makeId(),
          role: 'assistant',
          text: replyText,
          actions: sanitizeActions(actions),
        });
        return;
      }

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
          const refs = (Array.isArray(results) ? results : []).map(toAiSearchRef).filter(Boolean).slice(0, 20);

          if (refs.length === 0) {
            appendMessage({
              id: makeId(),
              role: 'assistant',
              text: `「${keyword}」に一致する予定/タスクは見つかりませんでした。`,
              actions: [],
            });
            return;
          }

          const { text: replyText, actions } = await runAssistant(userText, {
            searchContext: { mode: 'explicit', keyword, results: refs },
          });
          appendMessage({
            id: makeId(),
            role: 'assistant',
            text: replyText,
            actions: sanitizeActions(actions),
          });
          return;
        }
      }

      // Auto search (no explicit "検索" required)
      if (onSearchSchedules) {
        const keyword = extractSearchKeyword(userText);
        if (keyword) {
          try {
            const results = await onSearchSchedules(keyword);
            const refs = (Array.isArray(results) ? results : []).map(toAiSearchRef).filter(Boolean).slice(0, 20);
            if (refs.length > 0) {
              const { text: replyText, actions } = await runAssistant(userText, {
                searchContext: { mode: 'auto', keyword, results: refs },
              });
              appendMessage({
                id: makeId(),
                role: 'assistant',
                text: replyText,
                actions: sanitizeActions(actions),
              });
              return;
            }
          } catch (error) {
            // ignore auto-search errors; fall back to normal assistant
            console.warn('⚠️ Auto search failed:', error);
          }
        }
      }

      const { text: replyText, actions } = await runAssistant(userText);
      appendMessage({
        id: makeId(),
        role: 'assistant',
        text: replyText,
        actions: sanitizeActions(actions),
      });
    } catch (err) {
      setErrorText(err?.message || 'AIの処理に失敗しました。');
    } finally {
      setSending(false);
    }
  }, [appendMessage, input, list, onNavigateToDate, onSearchSchedules, runAssistant, selectedDate, selectedUpdateTarget, sending]);

  const startReviewAction = useCallback((action) => {
    if (!action) return;
    if (action.kind === 'selectTarget') {
      const id = action?.payload?.id ?? null;
      if (id != null) {
        const picked = (Array.isArray(list) ? list : []).find((s) => String(s?.id ?? '') === String(id)) || null;
        setSelectedUpdateTargetId(String(id));
        const text = normalizeText(pendingTargetText);
        const kind = normalizeText(pendingTargetKind);
        if (text) {
          setPendingTargetText(null);
          setPendingTargetKind(null);
          setSending(true);
          Promise.resolve()
            .then(async () => {
              if (kind === 'delete') {
                const target = picked || { id: String(id) };
                appendMessage({
                  id: makeId(),
                  role: 'assistant',
                  text: '削除（取り消し）の提案を作りました。内容がOKなら「最終確認」→「実行」で反映します。',
                  actions: sanitizeActions([
                    {
                      id: makeId(),
                      kind: 'delete',
                      title: target?.isTask ? 'タスクを削除（取り消し）' : '予定を削除（取り消し）',
                      summary: picked ? formatScheduleLabel(picked) : '',
                      payload: { id: String(id) },
                    },
                  ]),
                });
              } else {
                const { text: replyText, actions } = await runAssistant(text, { targetSchedule: picked });
                appendMessage({
                  id: makeId(),
                  role: 'assistant',
                  text: replyText,
                  actions: sanitizeActions(actions),
                });
              }
            })
            .catch((err) => {
              setErrorText(err?.message || 'AIの処理に失敗しました。');
            })
            .finally(() => {
              setSending(false);
            });
        } else {
          appendMessage({
            id: makeId(),
            role: 'assistant',
            text: `変更対象を選びました: ${formatScheduleLabel(selectedUpdateTarget || { id })}\n続けて変更内容を入力してください。`,
            actions: [],
          });
        }
      }
      return;
    }

    if (action.kind === 'create' || action.kind === 'update') {
      const sanitizedPayload = sanitizeSchedulePayload({
        kind: action.kind,
        payload: action.payload,
        fallbackDateStr: safeSelectedDateStr,
      });
      if (!sanitizedPayload) {
        setErrorText('提案内容が不正なため、最終確認に進めませんでした。');
        return;
      }
      setPendingAction({ ...action, payload: sanitizedPayload });
      return;
    }

    if (action.kind === 'delete') {
      const id = normalizeText(action?.payload?.id);
      if (!id) {
        setErrorText('提案内容が不正なため、最終確認に進めませんでした。');
        return;
      }
      setPendingAction({ ...action, payload: { id } });
      return;
    }

    if (action.kind === 'bulk') {
      const sanitized = sanitizeBulkPayload({ payload: action.payload, schedules: list });
      if (!sanitized) {
        setErrorText('提案内容（bulk）が不正なため、最終確認に進めませんでした。');
        return;
      }

      const picked = list
        .filter((s) => sanitized.ids.includes(String(s?.id ?? '')))
        .map((s) => normalizeText(s?.name))
        .filter(Boolean);
      const sample = picked.slice(0, 3).join(' / ');
      const more = picked.length > 3 ? ` 他${picked.length - 3}件` : '';
      const opLabel = sanitized.operation === 'relative' ? '相対' : '集約';
      const actLabel = sanitized.action === 'copy' ? 'コピー' : '移動';

      setPendingAction({
        ...action,
        payload: sanitized,
        summary:
          normalizeText(action?.summary) ||
          `${picked.length || sanitized.ids.length}件を${opLabel}で${actLabel} → ${sanitized.targetDate}${sample ? `\n対象: ${sample}${more}` : ''}`,
      });
      return;
    }

    setPendingAction(action);
  }, [appendMessage, list, pendingTargetKind, pendingTargetText, runAssistant, safeSelectedDateStr, selectedUpdateTarget]);

  const cancelPending = useCallback(() => {
    setPendingAction(null);
  }, []);

  const executePending = useCallback(async () => {
    const action = pendingAction;
    if (!action) return;

    if (action.kind !== 'create' && action.kind !== 'update' && action.kind !== 'delete' && action.kind !== 'bulk') {
      setPendingAction(null);
      return;
    }

    if ((action.kind === 'create' || action.kind === 'update') && !onSaveSchedule) {
      setErrorText('保存ハンドラが未設定です。');
      return;
    }

    if (action.kind === 'delete' && !onDeleteSchedule) {
      setErrorText('削除ハンドラが未設定です。');
      return;
    }

    if (action.kind === 'bulk' && !onScheduleUpdate) {
      setErrorText('一括更新ハンドラが未設定です。');
      return;
    }

    setErrorText('');
    setSending(true);
    try {
      if (action.kind === 'delete') {
        const id = normalizeText(action?.payload?.id);
        if (!id) throw new Error('実行内容が不正です。');
        await onDeleteSchedule(id);
      } else if (action.kind === 'bulk') {
        const sanitized = sanitizeBulkPayload({ payload: action.payload, schedules: list });
        if (!sanitized) {
          throw new Error('実行内容（bulk）が不正です。');
        }

        const targetDate = sanitized.targetDate;
        let deltaDays = 0;
        if (sanitized.operation === 'relative') {
          const base = list.find((s) => String(s?.id ?? '') === String(sanitized.baseId));
          const baseDate = normalizeText(base?.date);
          const fromNoon = parseDateStrToNoonLocal(baseDate);
          const toNoon = parseDateStrToNoonLocal(targetDate);
          if (!fromNoon || !toNoon) throw new Error('相対移動の基準日が不正です。');
          const msPerDay = 24 * 60 * 60 * 1000;
          deltaDays = Math.round((toNoon.getTime() - fromNoon.getTime()) / msPerDay);
        }

        const updates = sanitized.ids.map((id) => {
          const found = list.find((s) => String(s?.id ?? '') === String(id));
          if (!found) {
            throw new Error(`対象が見つかりませんでした（id: ${id}）。`);
          }

          const baseDate = normalizeText(found?.date);
          const nextDate =
            sanitized.operation === 'relative'
              ? (addDaysToDateStr(baseDate, deltaDays) || targetDate)
              : targetDate;

          if (sanitized.action === 'copy') {
            const next = {
              ...found,
              id: createTempId(),
              date: nextDate,
              notificationSettings: null,
            };
            if (Array.isArray(found?.notifications)) {
              next.notifications = [];
            }
            return next;
          }

          return {
            ...found,
            date: nextDate,
          };
        });

        const actionType =
          sanitized.action === 'copy'
            ? (sanitized.operation === 'relative' ? 'schedule_copy_multi_task_ai_relative' : 'schedule_copy_multi_task_ai_aggregate')
            : (sanitized.operation === 'relative' ? 'schedule_move_multi_task_ai_relative' : 'schedule_move_multi_task_ai_aggregate');

        await onScheduleUpdate(updates, actionType);
      } else {
        const sanitizedPayload = sanitizeSchedulePayload({
          kind: action.kind,
          payload: action.payload,
          fallbackDateStr: safeSelectedDateStr,
        });
        if (!sanitizedPayload) {
          throw new Error('実行内容が不正です。');
        }

        await onSaveSchedule(sanitizedPayload);
      }
      appendMessage({
        id: makeId(),
        role: 'assistant',
        text: `実行しました: ${normalizeText(action?.title) || '更新'}`,
        actions: [],
      });
      setPendingAction(null);
    } catch (err) {
      setErrorText(err?.message || '実行に失敗しました。');
    } finally {
      setSending(false);
    }
  }, [appendMessage, list, onDeleteSchedule, onSaveSchedule, onScheduleUpdate, pendingAction, safeSelectedDateStr]);

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
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-gray-100 text-gray-700" aria-hidden="true">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path d="M12 3v2" />
                <path d="M10 5h4" />
                <rect x="5" y="7" width="14" height="12" rx="2" />
                <path d="M9 16h6" />
                <circle cx="9" cy="12" r="1" />
                <circle cx="15" cy="12" r="1" />
              </svg>
            </span>
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
                  {(typeof pendingAction?.payload?.memo === 'string' && normalizeText(pendingAction?.payload?.memo)) && (
                    <div className="mt-2 text-xs text-gray-700 whitespace-pre-wrap">
                      メモ: {pendingAction.payload.memo}
                    </div>
                  )}
                  {(Array.isArray(pendingAction?.payload?.notifications) && pendingAction.payload.notifications.length > 0) && (
                    <div className="mt-1 text-xs text-gray-700">
                      通知: {pendingAction.payload.notifications.map((n) => `${n.value}${n.unit === 'minutes' ? '分' : n.unit === 'hours' ? '時間' : '日'}前`).join(' / ')}
                    </div>
                  )}
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
                  placeholder="例: 「ミーティング」を明日15時に追加（メモ: 事前資料確認 / 10分前に通知） / 「支払い」を検索"
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
