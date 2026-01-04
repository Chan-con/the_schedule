import { supabase } from '../lib/supabaseClient';

const nowPerf = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const buildDuration = (start) => Math.round(nowPerf() - start);
const logSupabase = (action, phase, detail = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    ...detail,
  };
  const message = `[Supabase:${action}] ${phase}`;
  const body = JSON.stringify(payload, null, 2);
  if (phase === 'error') {
    console.error(`${message} ${body}`);
  } else {
    console.info(`${message} ${body}`);
  }
};

const TABLE_NAME = 'schedules';

let scheduleTimeOrderSupport = 'unknown'; // 'unknown' | 'supported' | 'missing'
let lastScheduleTimeOrderProbeAt = 0;
const TIME_ORDER_PROBE_INTERVAL_MS = 5000;

const shouldTryTimeOrder = () => {
  if (scheduleTimeOrderSupport !== 'missing') return true;
  return Date.now() - lastScheduleTimeOrderProbeAt >= TIME_ORDER_PROBE_INTERVAL_MS;
};

const isMissingColumnError = (error, columnName) => {
  const msg = String(error?.message ?? '');
  if (!msg) return false;
  const lower = msg.toLowerCase();
  if (!msg.includes(columnName)) return false;

  // Postgres error examples:
  // - column "time_order" does not exist
  // - 列 "time_order" は存在しません
  if (lower.includes('column') && (lower.includes('does not exist') || msg.includes('存在しません'))) {
    return true;
  }

  // PostgREST schema cache error example:
  // - Could not find the 'time_order' column of 'schedules' in the schema cache
  if (lower.includes('schema cache') && lower.includes('could not find')) {
    return true;
  }

  return false;
};

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
    allDay: !!row.all_day,
    allDayOrder: typeof row.all_day_order === 'number' ? row.all_day_order : 0,
    timeOrder: typeof row.time_order === 'number' ? row.time_order : 0,
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
    all_day: !!schedule?.allDay,
    all_day_order: typeof schedule?.allDayOrder === 'number' ? schedule.allDayOrder : 0,
    time_order: typeof schedule?.timeOrder === 'number' ? schedule.timeOrder : 0,
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

  const runQuery = async (withTimeOrder) => {
    const selectFields = withTimeOrder
      ? 'id, user_id, name, date, time, memo, all_day, all_day_order, time_order, notifications, is_task, completed, created_at, updated_at'
      : 'id, user_id, name, date, time, memo, all_day, all_day_order, notifications, is_task, completed, created_at, updated_at';

    let query = supabase
      .from(TABLE_NAME)
      .select(selectFields)
      .eq('user_id', userId)
      .order('date', { ascending: true })
      .order('all_day', { ascending: false })
      .order('all_day_order', { ascending: true })
      .order('time', { ascending: true, nullsFirst: true });

    if (withTimeOrder) {
      query = query.order('time_order', { ascending: true, nullsFirst: false });
    }

    return query;
  };

  let data;
  let error;

  const tryTimeOrder = shouldTryTimeOrder();
  if (tryTimeOrder) {
    ({ data, error } = await runQuery(true));
    if (error && isMissingColumnError(error, 'time_order')) {
      scheduleTimeOrderSupport = 'missing';
      lastScheduleTimeOrderProbeAt = Date.now();
      logSupabase('fetchSchedules', 'info', { userId, message: 'time_order column missing; fallback without ordering' });
      ({ data, error } = await runQuery(false));
    } else if (!error) {
      scheduleTimeOrderSupport = 'supported';
    }
  } else {
    ({ data, error } = await runQuery(false));
  }

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
  const basePayload = mapToSupabaseRow(schedule, userId);
  delete basePayload.id;
  const startedAt = nowPerf();
  logSupabase('createSchedule', 'request', {
    userId,
    date: basePayload.date,
    time: basePayload.time,
    allDay: basePayload.all_day,
  });

  const runInsert = async (withTimeOrder) => {
    const payload = { ...basePayload };
    if (!withTimeOrder) {
      delete payload.time_order;
    }
    return supabase
      .from(TABLE_NAME)
      .insert([payload])
      .select()
      .single();
  };

  let data;
  let error;
  const tryTimeOrder = shouldTryTimeOrder();
  if (tryTimeOrder) {
    ({ data, error } = await runInsert(true));
    if (error && isMissingColumnError(error, 'time_order')) {
      scheduleTimeOrderSupport = 'missing';
      lastScheduleTimeOrderProbeAt = Date.now();
      logSupabase('createSchedule', 'info', { userId, message: 'time_order column missing; retry without time_order' });
      ({ data, error } = await runInsert(false));
    } else if (!error) {
      scheduleTimeOrderSupport = 'supported';
    }
  } else {
    ({ data, error } = await runInsert(false));
  }

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

  const basePayload = mapToSupabaseRow(schedule, userId);
  const startedAt = nowPerf();
  logSupabase('updateSchedule', 'request', {
    userId,
    scheduleId: basePayload.id,
    date: basePayload.date,
    time: basePayload.time,
    allDay: basePayload.all_day,
  });

  const runUpdate = async (withTimeOrder) => {
    const payload = { ...basePayload };
    if (!withTimeOrder) {
      delete payload.time_order;
    }
    return supabase
      .from(TABLE_NAME)
      .update(payload)
      .eq('id', schedule.id)
      .eq('user_id', userId)
      .select()
      .single();
  };

  let data;
  let error;
  const tryTimeOrder = shouldTryTimeOrder();
  if (tryTimeOrder) {
    ({ data, error } = await runUpdate(true));
    if (error && isMissingColumnError(error, 'time_order')) {
      scheduleTimeOrderSupport = 'missing';
      lastScheduleTimeOrderProbeAt = Date.now();
      logSupabase('updateSchedule', 'info', { userId, scheduleId: schedule.id, message: 'time_order column missing; retry without time_order' });
      ({ data, error } = await runUpdate(false));
    } else if (!error) {
      scheduleTimeOrderSupport = 'supported';
    }
  } else {
    ({ data, error } = await runUpdate(false));
  }

  if (error) {
    logSupabase('updateSchedule', 'error', {
      userId,
      scheduleId: basePayload.id,
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

  const runUpsert = async (withTimeOrder) => {
    const payloadRows = withTimeOrder
      ? rows
      : rows.map((row) => {
        const next = { ...row };
        delete next.time_order;
        return next;
      });

    return supabase
      .from(TABLE_NAME)
      .upsert(payloadRows, { onConflict: 'id' })
      .select();
  };

  let data;
  let error;
  const tryTimeOrder = shouldTryTimeOrder();
  if (tryTimeOrder) {
    ({ data, error } = await runUpsert(true));
    if (error && isMissingColumnError(error, 'time_order')) {
      scheduleTimeOrderSupport = 'missing';
      lastScheduleTimeOrderProbeAt = Date.now();
      logSupabase('upsertSchedules', 'info', { userId, message: 'time_order column missing; retry without time_order' });
      ({ data, error } = await runUpsert(false));
    } else if (!error) {
      scheduleTimeOrderSupport = 'supported';
    }
  } else {
    ({ data, error } = await runUpsert(false));
  }

  if (error) {
    logSupabase('upsertSchedules', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`予定の同期に失敗しました: ${error.message}`);
  }

  const mapped = (data || []).map(mapFromSupabaseRow);
  logSupabase('upsertSchedules', 'success', { userId, durationMs: buildDuration(startedAt), count: mapped.length });
  return mapped;
};
