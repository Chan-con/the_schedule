import { supabase } from '../lib/supabaseClient';

const TABLE_NAME = 'daily_quest_tasks';

const nowPerf = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const buildDuration = (start) => Math.round(nowPerf() - start);

const logDailyQuest = (action, phase, detail = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    ...detail,
  };
  const message = `[Supabase:${TABLE_NAME}:${action}] ${phase}`;
  const body = JSON.stringify(payload, null, 2);
  if (phase === 'error') {
    console.error(`${message} ${body}`);
  } else {
    console.info(`${message} ${body}`);
  }
};

export const fetchDailyQuestTasksForUserByDate = async ({ userId, dateStr }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const safeDate = String(dateStr ?? '').trim();
  if (!safeDate) return [];

  const startedAt = nowPerf();
  logDailyQuest('fetchByDate', 'request', { userId, dateStr: safeDate });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('id, user_id, date_str, title, completed, completed_at, sort_order, created_at, updated_at')
    .eq('user_id', userId)
    .eq('date_str', safeDate)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    logDailyQuest('fetchByDate', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`デイリークエストの取得に失敗しました: ${error.message}`);
  }

  const list = Array.isArray(data) ? data : [];
  logDailyQuest('fetchByDate', 'success', { userId, durationMs: buildDuration(startedAt), count: list.length });
  return list.map((row) => ({
    ...row,
    date_str: String(row?.date_str ?? ''),
    title: String(row?.title ?? ''),
    completed: !!row?.completed,
  }));
};

export const fetchDailyQuestTasksForUserInRange = async ({ userId, startDate, endDate }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const safeStart = String(startDate ?? '').trim();
  const safeEnd = String(endDate ?? '').trim();
  if (!safeStart || !safeEnd) return [];

  const startedAt = nowPerf();
  logDailyQuest('fetchRange', 'request', { userId, startDate: safeStart, endDate: safeEnd });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('id, user_id, date_str, title, completed, completed_at, sort_order, created_at, updated_at')
    .eq('user_id', userId)
    .gte('date_str', safeStart)
    .lte('date_str', safeEnd)
    .order('date_str', { ascending: true })
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    logDailyQuest('fetchRange', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`デイリークエストの取得に失敗しました: ${error.message}`);
  }

  const list = Array.isArray(data) ? data : [];
  logDailyQuest('fetchRange', 'success', { userId, durationMs: buildDuration(startedAt), count: list.length });
  return list.map((row) => ({
    ...row,
    date_str: String(row?.date_str ?? ''),
    title: String(row?.title ?? ''),
    completed: !!row?.completed,
  }));
};

export const createDailyQuestTaskForUser = async ({ userId, dateStr, title, sortOrder }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const safeDate = String(dateStr ?? '').trim();
  if (!safeDate) throw new Error('日付が指定されていません。');
  const safeTitle = String(title ?? '').trim();
  if (!safeTitle) throw new Error('タスク名が空です。');

  const payload = {
    user_id: userId,
    date_str: safeDate,
    title: safeTitle,
    completed: false,
    ...(sortOrder != null ? { sort_order: sortOrder } : {}),
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logDailyQuest('create', 'request', { userId, dateStr: safeDate, titleLength: safeTitle.length });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(payload)
    .select('id, user_id, date_str, title, completed, completed_at, sort_order, created_at, updated_at')
    .single();

  if (error) {
    logDailyQuest('create', 'error', { userId, durationMs: buildDuration(startedAt), code: error.code, message: error.message });
    const err = new Error(`デイリークエストの作成に失敗しました: ${error.message}`);
    err.code = error.code;
    err.details = error.details;
    err.hint = error.hint;
    err.original = error;
    throw err;
  }

  logDailyQuest('create', 'success', { userId, durationMs: buildDuration(startedAt), id: data?.id ?? null });
  return {
    ...data,
    date_str: String(data?.date_str ?? ''),
    title: String(data?.title ?? ''),
    completed: !!data?.completed,
  };
};

export const updateDailyQuestTaskForUser = async ({ userId, id, patch }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (id == null) throw new Error('更新対象IDが指定されていません。');

  const safePatch = patch && typeof patch === 'object' ? patch : {};
  const payload = {
    ...safePatch,
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logDailyQuest('update', 'request', { userId, id, keys: Object.keys(safePatch) });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq('id', id)
    .eq('user_id', userId)
    .select('id, user_id, date_str, title, completed, completed_at, sort_order, created_at, updated_at')
    .single();

  if (error) {
    logDailyQuest('update', 'error', { userId, durationMs: buildDuration(startedAt), code: error.code, message: error.message });
    const err = new Error(`デイリークエストの更新に失敗しました: ${error.message}`);
    err.code = error.code;
    err.details = error.details;
    err.hint = error.hint;
    err.original = error;
    throw err;
  }

  logDailyQuest('update', 'success', { userId, durationMs: buildDuration(startedAt), id: data?.id ?? null });
  return {
    ...data,
    date_str: String(data?.date_str ?? ''),
    title: String(data?.title ?? ''),
    completed: !!data?.completed,
  };
};

export const deleteDailyQuestTaskForUser = async ({ userId, id }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (id == null) throw new Error('削除対象IDが指定されていません。');

  const startedAt = nowPerf();
  logDailyQuest('delete', 'request', { userId, id });

  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    logDailyQuest('delete', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`デイリークエストの削除に失敗しました: ${error.message}`);
  }

  logDailyQuest('delete', 'success', { userId, durationMs: buildDuration(startedAt), id });
};

export const reorderDailyQuestTasks = async ({ dateStr, orderedIds }) => {
  const safeDate = String(dateStr ?? '').trim();
  const ids = Array.isArray(orderedIds) ? orderedIds.map((v) => (v == null ? null : Number(v))).filter((v) => v != null) : [];
  if (!safeDate) throw new Error('日付が指定されていません。');
  if (ids.length === 0) return;

  const startedAt = nowPerf();
  logDailyQuest('reorder', 'request', { dateStr: safeDate, count: ids.length });

  const { error } = await supabase
    .rpc('reorder_daily_quest_tasks', {
      target_date: safeDate,
      ordered_ids: ids,
    });

  if (error) {
    logDailyQuest('reorder', 'error', { durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`デイリークエストの並び替えに失敗しました: ${error.message}`);
  }

  logDailyQuest('reorder', 'success', { durationMs: buildDuration(startedAt), dateStr: safeDate });
};
