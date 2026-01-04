import { supabase } from '../lib/supabaseClient';

const TABLE_NAME = 'quest_tasks';

const nowPerf = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const buildDuration = (start) => Math.round(nowPerf() - start);
const logQuest = (action, phase, detail = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    ...detail,
  };
  const message = `[Supabase:quest_tasks:${action}] ${phase}`;
  const body = JSON.stringify(payload, null, 2);
  if (phase === 'error') {
    console.error(`${message} ${body}`);
  } else {
    console.info(`${message} ${body}`);
  }
};

const normalizePeriod = (value) => {
  const v = String(value || '').trim();
  if (v === 'daily' || v === 'weekly' || v === 'monthly') return v;
  return 'daily';
};

export const fetchQuestTasksForUser = async (userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const startedAt = nowPerf();
  logQuest('fetchAll', 'request', { userId });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('id, user_id, period, title, completed_cycle_id, created_at, updated_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    logQuest('fetchAll', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`クエストを取得できませんでした: ${error.message}`);
  }

  const list = Array.isArray(data) ? data : [];
  logQuest('fetchAll', 'success', { userId, durationMs: buildDuration(startedAt), count: list.length });

  return list.map((row) => ({
    ...row,
    period: normalizePeriod(row?.period),
    title: String(row?.title ?? ''),
  }));
};

export const createQuestTaskForUser = async ({ userId, period, title }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');

  const safeTitle = String(title ?? '').trim();
  if (!safeTitle) throw new Error('タスク名が空です。');

  const payload = {
    user_id: userId,
    period: normalizePeriod(period),
    title: safeTitle,
    completed_cycle_id: null,
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logQuest('create', 'request', { userId, period: payload.period, titleLength: safeTitle.length });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(payload)
    .select('id, user_id, period, title, completed_cycle_id, created_at, updated_at')
    .single();

  if (error) {
    logQuest('create', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`クエストの作成に失敗しました: ${error.message}`);
  }

  logQuest('create', 'success', { userId, durationMs: buildDuration(startedAt), id: data?.id ?? null });
  return {
    ...data,
    period: normalizePeriod(data?.period),
    title: String(data?.title ?? ''),
  };
};

export const updateQuestTaskForUser = async ({ userId, id, patch }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (id == null) throw new Error('更新対象IDが指定されていません。');

  const safePatch = patch && typeof patch === 'object' ? patch : {};
  const payload = {
    ...safePatch,
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logQuest('update', 'request', { userId, id, keys: Object.keys(safePatch) });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq('id', id)
    .eq('user_id', userId)
    .select('id, user_id, period, title, completed_cycle_id, created_at, updated_at')
    .single();

  if (error) {
    logQuest('update', 'error', { userId, id, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`クエストの更新に失敗しました: ${error.message}`);
  }

  logQuest('update', 'success', { userId, id, durationMs: buildDuration(startedAt) });
  return {
    ...data,
    period: normalizePeriod(data?.period),
    title: String(data?.title ?? ''),
  };
};
