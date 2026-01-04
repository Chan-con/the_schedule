import { supabase } from '../lib/supabaseClient';

const TABLE_NAME = 'quest_tasks';

let questSortOrderSupported = true;

const isMissingColumnError = (error, columnName) => {
  const msg = String(error?.message ?? '');
  if (!msg) return false;
  if (!msg.toLowerCase().includes('column')) return false;
  if (!msg.includes(columnName)) return false;
  return msg.toLowerCase().includes('does not exist') || msg.includes('存在しません');
};

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

  const runQuery = async (withSortOrder) => {
    const selectFields = withSortOrder
      ? 'id, user_id, period, title, completed_cycle_id, sort_order, created_at, updated_at'
      : 'id, user_id, period, title, completed_cycle_id, created_at, updated_at';
    let query = supabase
      .from(TABLE_NAME)
      .select(selectFields)
      .eq('user_id', userId);

    if (withSortOrder) {
      query = query.order('period', { ascending: true })
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true });
    } else {
      query = query.order('created_at', { ascending: true })
        .order('id', { ascending: true });
    }
    return query;
  };

  let data;
  let error;
  if (questSortOrderSupported) {
    ({ data, error } = await runQuery(true));
    if (error && isMissingColumnError(error, 'sort_order')) {
      questSortOrderSupported = false;
      logQuest('fetchAll', 'info', { userId, message: 'sort_order column missing; fallback without ordering' });
      ({ data, error } = await runQuery(false));
    }
  } else {
    ({ data, error } = await runQuery(false));
  }

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

export const createQuestTaskForUser = async ({ userId, period, title, sortOrder }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');

  const safeTitle = String(title ?? '').trim();
  if (!safeTitle) throw new Error('タスク名が空です。');

  const payload = {
    user_id: userId,
    period: normalizePeriod(period),
    title: safeTitle,
    completed_cycle_id: null,
    updated_at: new Date().toISOString(),
    ...(questSortOrderSupported && sortOrder != null ? { sort_order: sortOrder } : {}),
  };

  const startedAt = nowPerf();
  logQuest('create', 'request', { userId, period: payload.period, titleLength: safeTitle.length });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert(payload)
    .select(questSortOrderSupported ? 'id, user_id, period, title, completed_cycle_id, sort_order, created_at, updated_at' : 'id, user_id, period, title, completed_cycle_id, created_at, updated_at')
    .single();

  if (error) {
    if (questSortOrderSupported && isMissingColumnError(error, 'sort_order')) {
      questSortOrderSupported = false;
      logQuest('create', 'info', { userId, message: 'sort_order column missing; retry without sort_order' });
      const retryPayload = { ...payload };
      delete retryPayload.sort_order;
      const { data: retryData, error: retryError } = await supabase
        .from(TABLE_NAME)
        .insert(retryPayload)
        .select('id, user_id, period, title, completed_cycle_id, created_at, updated_at')
        .single();
      if (retryError) {
        logQuest('create', 'error', { userId, durationMs: buildDuration(startedAt), message: retryError.message });
        throw new Error(`クエストの作成に失敗しました: ${retryError.message}`);
      }
      logQuest('create', 'success', { userId, durationMs: buildDuration(startedAt), id: retryData?.id ?? null });
      return {
        ...retryData,
        period: normalizePeriod(retryData?.period),
        title: String(retryData?.title ?? ''),
      };
    }
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
  const safePatchNormalized = { ...safePatch };
  if (!questSortOrderSupported && Object.prototype.hasOwnProperty.call(safePatchNormalized, 'sort_order')) {
    delete safePatchNormalized.sort_order;
  }
  const payload = {
    ...safePatchNormalized,
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logQuest('update', 'request', { userId, id, keys: Object.keys(safePatch) });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq('id', id)
    .eq('user_id', userId)
    .select(questSortOrderSupported ? 'id, user_id, period, title, completed_cycle_id, sort_order, created_at, updated_at' : 'id, user_id, period, title, completed_cycle_id, created_at, updated_at')
    .single();

  if (error) {
    if (questSortOrderSupported && isMissingColumnError(error, 'sort_order')) {
      questSortOrderSupported = false;
      logQuest('update', 'info', { userId, id, message: 'sort_order column missing; retry without sort_order' });
      const retryPatch = { ...payload };
      delete retryPatch.sort_order;
      const { data: retryData, error: retryError } = await supabase
        .from(TABLE_NAME)
        .update(retryPatch)
        .eq('id', id)
        .eq('user_id', userId)
        .select('id, user_id, period, title, completed_cycle_id, created_at, updated_at')
        .single();
      if (retryError) {
        logQuest('update', 'error', { userId, id, durationMs: buildDuration(startedAt), message: retryError.message });
        throw new Error(`クエストの更新に失敗しました: ${retryError.message}`);
      }
      logQuest('update', 'success', { userId, id, durationMs: buildDuration(startedAt) });
      return {
        ...retryData,
        period: normalizePeriod(retryData?.period),
        title: String(retryData?.title ?? ''),
      };
    }
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

export const deleteQuestTaskForUser = async ({ userId, id }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (id == null) throw new Error('削除対象IDが指定されていません。');

  const startedAt = nowPerf();
  logQuest('delete', 'request', { userId, id });

  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    logQuest('delete', 'error', { userId, id, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`クエストの削除に失敗しました: ${error.message}`);
  }

  logQuest('delete', 'success', { userId, id, durationMs: buildDuration(startedAt) });
};
