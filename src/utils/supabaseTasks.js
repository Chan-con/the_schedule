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

const TABLE_NAME = 'tasks';

const sanitizeNotifications = (notifications) => {
  if (!notifications) return [];
  try {
    return JSON.parse(JSON.stringify(notifications));
  } catch {
    return Array.isArray(notifications) ? [...notifications] : [];
  }
};

export const mapFromSupabaseTaskRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name || '',
    date: row.date || '',
    time: row.time || '',
    memo: row.memo || '',
    emoji: row.emoji || '',
    allDay: row.all_day != null ? !!row.all_day : !(row.time),
    notifications: sanitizeNotifications(row.notifications),
    completed: !!row.completed,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    isTask: true,
    isStandaloneTask: true,
    source: 'standaloneTask',
  };
};

const mapToSupabaseTaskRow = (task, userId) => {
  const notifications = sanitizeNotifications(task?.notifications);
  return {
    id: task?.id || undefined,
    user_id: userId,
    name: task?.name || '',
    date: task?.date || '',
    time: task?.time ? task.time : null,
    memo: task?.memo || '',
    emoji: task?.emoji || '',
    all_day: task?.allDay != null ? !!task.allDay : !task?.time,
    notifications,
    completed: !!task?.completed,
  };
};

export const fetchTasksForUser = async (userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const startedAt = nowPerf();
  logSupabase('fetchTasks', 'request', { userId });
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true, nullsFirst: true })
    .order('time', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true });

  if (error) {
    logSupabase('fetchTasks', 'error', {
      userId,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`Supabaseからタスクを取得できませんでした: ${error.message}`);
  }

  const mapped = (data || []).map(mapFromSupabaseTaskRow);
  logSupabase('fetchTasks', 'success', {
    userId,
    durationMs: buildDuration(startedAt),
    count: mapped.length,
  });
  return mapped;
};

export const createTaskForUser = async (task, userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const payload = mapToSupabaseTaskRow(task, userId);
  delete payload.id;
  const startedAt = nowPerf();
  logSupabase('createTask', 'request', {
    userId,
    date: payload.date,
    time: payload.time,
  });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .insert([payload])
    .select()
    .single();

  if (error) {
    logSupabase('createTask', 'error', {
      userId,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`タスクを登録できませんでした: ${error.message}`);
  }

  const mapped = mapFromSupabaseTaskRow(data);
  logSupabase('createTask', 'success', {
    userId,
    durationMs: buildDuration(startedAt),
    taskId: mapped.id,
  });
  return mapped;
};

export const updateTaskForUser = async (task, userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (!task?.id) throw new Error('更新対象のタスクIDが指定されていません。');

  const payload = mapToSupabaseTaskRow(task, userId);
  const startedAt = nowPerf();
  logSupabase('updateTask', 'request', {
    userId,
    taskId: payload.id,
    date: payload.date,
    time: payload.time,
  });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .update(payload)
    .eq('id', task.id)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    logSupabase('updateTask', 'error', {
      userId,
      taskId: payload.id,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`タスクを更新できませんでした: ${error.message}`);
  }

  const mapped = mapFromSupabaseTaskRow(data);
  logSupabase('updateTask', 'success', {
    userId,
    taskId: mapped.id,
    durationMs: buildDuration(startedAt),
  });
  return mapped;
};

export const deleteTaskForUser = async (taskId, userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (!taskId) throw new Error('削除対象のタスクIDが指定されていません。');

  const startedAt = nowPerf();
  logSupabase('deleteTask', 'request', { userId, taskId });
  const { error } = await supabase
    .from(TABLE_NAME)
    .delete()
    .eq('id', taskId)
    .eq('user_id', userId);

  if (error) {
    logSupabase('deleteTask', 'error', {
      userId,
      taskId,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`タスクを削除できませんでした: ${error.message}`);
  }

  logSupabase('deleteTask', 'success', {
    userId,
    taskId,
    durationMs: buildDuration(startedAt),
  });
};

export const upsertTasksForUser = async (tasks, userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return [];
  }

  const rows = tasks.map((task) => {
    if (!task?.id) {
      throw new Error('更新するタスクにはIDが必要です。');
    }
    return mapToSupabaseTaskRow(task, userId);
  });

  const startedAt = nowPerf();
  logSupabase('upsertTasks', 'request', { userId, count: rows.length });
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .upsert(rows, { onConflict: 'id' })
    .select();

  if (error) {
    logSupabase('upsertTasks', 'error', {
      userId,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`タスクの同期に失敗しました: ${error.message}`);
  }

  const mapped = (data || []).map(mapFromSupabaseTaskRow);
  logSupabase('upsertTasks', 'success', {
    userId,
    durationMs: buildDuration(startedAt),
    count: mapped.length,
  });
  return mapped;
};
