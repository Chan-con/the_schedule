import { supabase } from '../lib/supabaseClient';

const TABLE_NAME = 'daily_quest_snapshots';

const nowPerf = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const buildDuration = (start) => Math.round(nowPerf() - start);

const logDailySnapshot = (action, phase, detail = {}) => {
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

export const fetchDailyQuestSnapshotsForUserInRange = async ({ userId, startDate, endDate }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const safeStart = String(startDate ?? '').trim();
  const safeEnd = String(endDate ?? '').trim();
  if (!safeStart || !safeEnd) return [];

  const startedAt = nowPerf();
  logDailySnapshot('fetchRange', 'request', { userId, startDate: safeStart, endDate: safeEnd });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('id, user_id, date_str, total_count, completed_count, is_cleared, recorded_at, created_at, updated_at')
    .eq('user_id', userId)
    .gte('date_str', safeStart)
    .lte('date_str', safeEnd)
    .order('date_str', { ascending: true });

  if (error) {
    logDailySnapshot('fetchRange', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`デイリー確定情報の取得に失敗しました: ${error.message}`);
  }

  const list = Array.isArray(data) ? data : [];
  logDailySnapshot('fetchRange', 'success', { userId, durationMs: buildDuration(startedAt), count: list.length });
  return list.map((row) => ({
    ...row,
    date_str: String(row?.date_str ?? ''),
    total_count: Number(row?.total_count ?? 0),
    completed_count: Number(row?.completed_count ?? 0),
    is_cleared: !!row?.is_cleared,
  }));
};

export const recordDailyQuestSnapshot = async ({ targetDateStr }) => {
  const safeDate = String(targetDateStr ?? '').trim();
  if (!safeDate) throw new Error('日付が指定されていません。');

  const startedAt = nowPerf();
  logDailySnapshot('record', 'request', { targetDateStr: safeDate });

  const { data, error } = await supabase
    .rpc('record_daily_quest_snapshot', {
      target_date: safeDate,
    });

  if (error) {
    logDailySnapshot('record', 'error', { durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`デイリー確定情報の保存に失敗しました: ${error.message}`);
  }

  logDailySnapshot('record', 'success', { durationMs: buildDuration(startedAt), dateStr: safeDate });
  return data ?? null;
};
