import { supabase } from '../lib/supabaseClient';

const nowPerf = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const buildDuration = (start) => Math.round(nowPerf() - start);
const logSupabase = (action, phase, detail = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    ...detail,
  };
  const message = `[Supabase:${action}] ${phase}`;
  if (phase === 'error') {
    console.error(message, payload);
  } else {
    console.info(message, payload);
  }
};

const TABLE_NAME = 'schedules';

const sanitizeNotifications = (notifications) => {
  if (!notifications) return [];
  try {
    return JSON.parse(JSON.stringify(notifications));
  } catch {
    return Array.isArray(notifications) ? [...notifications] : [];
  }
};

export const mapFromSupabaseRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name || '',
    date: row.date || '',
    time: row.time || '',
    memo: row.memo || '',
    emoji: row.emoji || '',
    allDay: !!row.all_day,
    allDayOrder: typeof row.all_day_order === 'number' ? row.all_day_order : 0,
    notifications: sanitizeNotifications(row.notifications),
    isTask: !!row.is_task,
    completed: !!row.completed,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
};

const mapToSupabaseRow = (schedule, userId) => {
  const notifications = sanitizeNotifications(schedule?.notifications);
  const payload = {
    id: schedule?.id || undefined,
    user_id: userId,
    name: schedule?.name || '',
    date: schedule?.date || '',
    time: schedule?.time ? schedule.time : null,
    memo: schedule?.memo || '',
    emoji: schedule?.emoji || '',
    all_day: !!schedule?.allDay,
    all_day_order: typeof schedule?.allDayOrder === 'number' ? schedule.allDayOrder : 0,
    notifications,
    is_task: !!schedule?.isTask,
    completed: !!schedule?.completed,
  };

  return payload;
};

export const fetchSchedulesForUser = async (userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const startedAt = nowPerf();
  logSupabase('fetchSchedules', 'request', { userId });
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true })
    .order('all_day', { ascending: false })
    .order('all_day_order', { ascending: true })
    .order('time', { ascending: true, nullsFirst: true });

  if (error) {
    logSupabase('fetchSchedules', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`Supabaseから予定を取得できませんでした: ${error.message}`);
  }

  const mapped = (data || []).map(mapFromSupabaseRow);
  logSupabase('fetchSchedules', 'success', { userId, durationMs: buildDuration(startedAt), count: mapped.length });
  return mapped;
};

export const createScheduleForUser = async (schedule, userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const payload = mapToSupabaseRow(schedule, userId);
  delete payload.id;
  const startedAt = nowPerf();
  logSupabase('createSchedule', 'request', {
    userId,
    date: payload.date,
    time: payload.time,
    allDay: payload.all_day,
  });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert([payload])
    .select()
    .single();

  if (error) {
    logSupabase('createSchedule', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`予定を登録できませんでした: ${error.message}`);
  }

  const mapped = mapFromSupabaseRow(data);
  logSupabase('createSchedule', 'success', {
    userId,
    durationMs: buildDuration(startedAt),
    scheduleId: mapped.id,
  });
  return mapped;
};

export const updateScheduleForUser = async (schedule, userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (!schedule?.id) throw new Error('更新対象の予定IDが指定されていません。');

  const payload = mapToSupabaseRow(schedule, userId);
  const startedAt = nowPerf();
  logSupabase('updateSchedule', 'request', {
    userId,
    scheduleId: payload.id,
    date: payload.date,
    time: payload.time,
    allDay: payload.all_day,
  });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq('id', schedule.id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    logSupabase('updateSchedule', 'error', {
      userId,
      scheduleId: payload.id,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`予定を更新できませんでした: ${error.message}`);
  }

  const mapped = mapFromSupabaseRow(data);
  logSupabase('updateSchedule', 'success', {
    userId,
    scheduleId: mapped.id,
    durationMs: buildDuration(startedAt),
  });
  return mapped;
};

export const deleteScheduleForUser = async (scheduleId, userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (!scheduleId) throw new Error('削除対象の予定IDが指定されていません。');

  const startedAt = nowPerf();
  logSupabase('deleteSchedule', 'request', { userId, scheduleId });
  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('id', scheduleId)
    .eq('user_id', userId);

  if (error) {
    logSupabase('deleteSchedule', 'error', { userId, scheduleId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`予定を削除できませんでした: ${error.message}`);
  }

  logSupabase('deleteSchedule', 'success', { userId, scheduleId, durationMs: buildDuration(startedAt) });
};

export const upsertSchedulesForUser = async (schedules, userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return [];
  }

  const rows = schedules.map((schedule) => {
    if (!schedule?.id) {
      throw new Error('更新する予定にはIDが必要です。');
    }
    return mapToSupabaseRow(schedule, userId);
  });

  const startedAt = nowPerf();
  logSupabase('upsertSchedules', 'request', { userId, count: rows.length });
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .upsert(rows, { onConflict: 'id' })
    .select();

  if (error) {
    logSupabase('upsertSchedules', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`予定の同期に失敗しました: ${error.message}`);
  }

  const mapped = (data || []).map(mapFromSupabaseRow);
  logSupabase('upsertSchedules', 'success', { userId, durationMs: buildDuration(startedAt), count: mapped.length });
  return mapped;
};
