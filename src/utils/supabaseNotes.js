import { supabase } from '../lib/supabaseClient';
import { fromDateStrLocal, toDateStrLocal } from './date';

const TABLE_NAME = 'notes';

const nowPerf = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const buildDuration = (start) => Math.round(nowPerf() - start);
const logNotes = (action, phase, detail = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    ...detail,
  };
  const message = `[Supabase:notes:${action}] ${phase}`;
  const body = JSON.stringify(payload, null, 2);
  if (phase === 'error') {
    console.error(`${message} ${body}`);
  } else {
    console.info(`${message} ${body}`);
  }
};

export const fetchNotesForUserByDate = async (userId, dateStr) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (!dateStr) return [];

  const startedAt = nowPerf();
  logNotes('fetchByDate', 'request', { userId, date: dateStr });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('id, date, title, content, created_at, updated_at')
    .eq('user_id', userId)
    .eq('date', dateStr)
    .order('updated_at', { ascending: false });

  if (error) {
    logNotes('fetchByDate', 'error', { userId, date: dateStr, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`ノートを取得できませんでした: ${error.message}`);
  }

  const result = Array.isArray(data) ? data : [];
  logNotes('fetchByDate', 'success', { userId, date: dateStr, durationMs: buildDuration(startedAt), count: result.length });
  return result;
};

export const fetchNotesForUser = async (userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');

  const startedAt = nowPerf();
  logNotes('fetchAll', 'request', { userId });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('id, date, title, content, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    logNotes('fetchAll', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`ノートを取得できませんでした: ${error.message}`);
  }

  const result = Array.isArray(data) ? data : [];
  logNotes('fetchAll', 'success', { userId, durationMs: buildDuration(startedAt), count: result.length });
  return result;
};

export const createNoteForUser = async ({ userId, date, title = '', content = '' }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (!date) throw new Error('日付が指定されていません。');

  const payload = {
    user_id: userId,
    date,
    title: title ?? '',
    content: content ?? '',
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logNotes('create', 'request', { userId, date, titleLength: String(payload.title).length, contentLength: String(payload.content).length });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(payload)
    .select('id, date, title, content, created_at, updated_at')
    .single();

  if (error) {
    logNotes('create', 'error', { userId, date, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`ノートを作成できませんでした: ${error.message}`);
  }

  logNotes('create', 'success', { userId, date, durationMs: buildDuration(startedAt), id: data?.id });
  return data;
};

export const updateNoteForUser = async ({ userId, id, patch }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (id == null) throw new Error('ノートIDが指定されていません。');

  const safePatch = patch && typeof patch === 'object' ? patch : {};
  const payload = {
    ...safePatch,
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logNotes('update', 'request', { userId, id, keys: Object.keys(safePatch) });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq('user_id', userId)
    .eq('id', id)
    .select('id, date, title, content, created_at, updated_at')
    .single();

  if (error) {
    logNotes('update', 'error', { userId, id, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`ノートを更新できませんでした: ${error.message}`);
  }

  logNotes('update', 'success', { userId, id, durationMs: buildDuration(startedAt) });
  return data;
};

export const deleteNoteForUser = async ({ userId, id }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (id == null) throw new Error('ノートIDが指定されていません。');

  const startedAt = nowPerf();
  logNotes('delete', 'request', { userId, id });

  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('user_id', userId)
    .eq('id', id);

  if (error) {
    logNotes('delete', 'error', { userId, id, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`ノートを削除できませんでした: ${error.message}`);
  }

  logNotes('delete', 'success', { userId, id, durationMs: buildDuration(startedAt) });
};

export const fetchNoteForUserById = async ({ userId, id }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (id == null) throw new Error('ノートIDが指定されていません。');

  const startedAt = nowPerf();
  logNotes('fetchOne', 'request', { userId, id });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('id, date, title, content, created_at, updated_at')
    .eq('user_id', userId)
    .eq('id', id)
    .single();

  if (error) {
    logNotes('fetchOne', 'error', { userId, id, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`ノートを取得できませんでした: ${error.message}`);
  }

  logNotes('fetchOne', 'success', { userId, id, durationMs: buildDuration(startedAt) });
  return data;
};

export const fetchNoteDatesForUserInRange = async ({ userId, startDate, endDate }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (!startDate || !endDate) return [];

  const startLocal = fromDateStrLocal(startDate);
  const endLocal = fromDateStrLocal(endDate);
  if (!startLocal || !endLocal) return [];

  // endDate当日を含めるため、翌日00:00を上限（排他的）にする
  const endExclusive = new Date(endLocal);
  endExclusive.setDate(endExclusive.getDate() + 1);

  const startedAt = nowPerf();
  logNotes('fetchDates', 'request', { userId, startDate, endDate });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('created_at')
    .eq('user_id', userId)
    .gte('created_at', startLocal.toISOString())
    .lt('created_at', endExclusive.toISOString());

  if (error) {
    logNotes('fetchDates', 'error', { userId, startDate, endDate, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`ノート日付一覧を取得できませんでした: ${error.message}`);
  }

  const dateSet = new Set();
  (Array.isArray(data) ? data : []).forEach((row) => {
    const createdAt = row?.created_at;
    if (!createdAt) return;
    const dateStr = toDateStrLocal(new Date(createdAt));
    if (dateStr) {
      dateSet.add(dateStr);
    }
  });

  const dates = Array.from(dateSet);
  logNotes('fetchDates', 'success', { userId, startDate, endDate, durationMs: buildDuration(startedAt), count: dates.length });
  return dates;
};
