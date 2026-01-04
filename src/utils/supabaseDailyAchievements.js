import { supabase } from '../lib/supabaseClient';

const TABLE_NAME = 'daily_achievements';

const nowPerf = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const buildDuration = (start) => Math.round(nowPerf() - start);

const logDaily = (action, phase, detail = {}) => {
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

const isMissingTableError = (error) => {
  const msg = String(error?.message ?? '');
  if (!msg) return false;
  const lower = msg.toLowerCase();
  // PostgREST: Could not find the 'daily_achievements' table in the schema cache
  if (lower.includes('schema cache') && lower.includes('could not find') && lower.includes(TABLE_NAME)) return true;
  // Postgres: relation "daily_achievements" does not exist
  if (lower.includes('does not exist') && lower.includes(TABLE_NAME)) return true;
  // 日本語
  if (msg.includes('存在しません') && msg.includes(TABLE_NAME)) return true;
  return false;
};

export const fetchDailyAchievementsForUserInRange = async ({ userId, startDate, endDate }) => {
  throw new Error('旧スキーマの daily_achievements は削除済みです。daily_quest_snapshots を使用してください。');
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const safeStart = String(startDate ?? '').trim();
  const safeEnd = String(endDate ?? '').trim();
  if (!safeStart || !safeEnd) return [];

  const startedAt = nowPerf();
  logDaily('fetchRange', 'request', { userId, startDate: safeStart, endDate: safeEnd });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('id, user_id, date_str, status, confirmed_at, created_at, updated_at')
    .eq('user_id', userId)
    .gte('date_str', safeStart)
    .lte('date_str', safeEnd)
    .order('date_str', { ascending: true });

  if (error) {
    if (isMissingTableError(error)) {
      logDaily('fetchRange', 'info', { userId, durationMs: buildDuration(startedAt), message: 'table missing; skip' });
      return [];
    }
    logDaily('fetchRange', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`日次達成の取得に失敗しました: ${error.message}`);
  }

  const list = Array.isArray(data) ? data : [];
  logDaily('fetchRange', 'success', { userId, durationMs: buildDuration(startedAt), count: list.length });
  return list.map((row) => ({
    ...row,
    date_str: String(row?.date_str ?? ''),
    status: String(row?.status ?? ''),
  }));
};

export const upsertDailyAchievementForUser = async ({ userId, dateStr, status }) => {
  throw new Error('旧スキーマの daily_achievements は削除済みです。daily_quest_snapshots を使用してください。');
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const safeDate = String(dateStr ?? '').trim();
  if (!safeDate) throw new Error('日付が指定されていません。');
  const safeStatus = String(status ?? '').trim() || 'pending';

  const payload = {
    user_id: userId,
    date_str: safeDate,
    status: safeStatus,
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logDaily('upsert', 'request', { userId, dateStr: safeDate, status: safeStatus });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .upsert(payload, { onConflict: 'user_id,date_str' })
    .select('id, user_id, date_str, status, confirmed_at, created_at, updated_at')
    .single();

  if (error) {
    if (isMissingTableError(error)) {
      logDaily('upsert', 'info', { userId, durationMs: buildDuration(startedAt), message: 'table missing; skip' });
      return null;
    }
    logDaily('upsert', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`日次達成の保存に失敗しました: ${error.message}`);
  }

  logDaily('upsert', 'success', { userId, durationMs: buildDuration(startedAt), id: data?.id ?? null });
  return data;
};

export const deletePendingDailyAchievementForUser = async ({ userId, dateStr }) => {
  throw new Error('旧スキーマの daily_achievements は削除済みです。daily_quest_snapshots を使用してください。');
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const safeDate = String(dateStr ?? '').trim();
  if (!safeDate) throw new Error('日付が指定されていません。');

  const startedAt = nowPerf();
  logDaily('deletePending', 'request', { userId, dateStr: safeDate });

  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('user_id', userId)
    .eq('date_str', safeDate)
    .eq('status', 'pending');

  if (error) {
    if (isMissingTableError(error)) {
      logDaily('deletePending', 'info', { userId, durationMs: buildDuration(startedAt), message: 'table missing; skip' });
      return;
    }
    logDaily('deletePending', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`日次達成の削除に失敗しました: ${error.message}`);
  }

  logDaily('deletePending', 'success', { userId, durationMs: buildDuration(startedAt) });
};

export const confirmDailyAchievementsBeforeDate = async ({ userId, beforeDateStr }) => {
  throw new Error('旧スキーマの daily_achievements は削除済みです。daily_quest_snapshots を使用してください。');
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const safeBefore = String(beforeDateStr ?? '').trim();
  if (!safeBefore) return 0;

  const startedAt = nowPerf();
  logDaily('confirmBefore', 'request', { userId, beforeDateStr: safeBefore });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update({
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('status', 'pending')
    .lt('date_str', safeBefore)
    .select('id');

  if (error) {
    if (isMissingTableError(error)) {
      logDaily('confirmBefore', 'info', { userId, durationMs: buildDuration(startedAt), message: 'table missing; skip' });
      return 0;
    }
    logDaily('confirmBefore', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`日次達成の確定に失敗しました: ${error.message}`);
  }

  const count = Array.isArray(data) ? data.length : 0;
  logDaily('confirmBefore', 'success', { userId, durationMs: buildDuration(startedAt), count });
  return count;
};
