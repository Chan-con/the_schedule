import { supabase } from '../lib/supabaseClient';

const TABLE_NAME = 'quest_reminder_settings';

const nowPerf = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const buildDuration = (start) => Math.round(nowPerf() - start);

const logQuestReminder = (action, phase, detail = {}) => {
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

const normalizeTimeMinutes = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const clamped = Math.max(0, Math.min(1439, Math.floor(n)));
  return clamped;
};

export const fetchQuestReminderSettingsForUser = async ({ userId }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');

  const startedAt = nowPerf();
  logQuestReminder('fetch', 'request', { userId });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('user_id, enabled, reminder_time_minutes, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logQuestReminder('fetch', 'error', {
      userId,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`クエスト通知設定の取得に失敗しました: ${error.message}`);
  }

  const row = data || null;
  logQuestReminder('fetch', 'success', {
    userId,
    durationMs: buildDuration(startedAt),
    exists: !!row,
  });

  return row
    ? {
        user_id: String(row.user_id),
        enabled: !!row.enabled,
        reminder_time_minutes:
          normalizeTimeMinutes(row.reminder_time_minutes) ?? 21 * 60,
      }
    : null;
};

export const upsertQuestReminderSettingsForUser = async ({ userId, enabled, reminderTimeMinutes }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');

  const timeMinutes = normalizeTimeMinutes(reminderTimeMinutes);
  if (timeMinutes == null) throw new Error('通知時刻が不正です。');

  const payload = {
    user_id: userId,
    enabled: !!enabled,
    reminder_time_minutes: timeMinutes,
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logQuestReminder('upsert', 'request', {
    userId,
    enabled: payload.enabled,
    reminderTimeMinutes: payload.reminder_time_minutes,
  });

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .upsert(payload, { onConflict: 'user_id' })
    .select('user_id, enabled, reminder_time_minutes')
    .single();

  if (error) {
    logQuestReminder('upsert', 'error', {
      userId,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`クエスト通知設定の保存に失敗しました: ${error.message}`);
  }

  logQuestReminder('upsert', 'success', {
    userId,
    durationMs: buildDuration(startedAt),
  });

  return {
    user_id: String(data.user_id),
    enabled: !!data.enabled,
    reminder_time_minutes: normalizeTimeMinutes(data.reminder_time_minutes) ?? 21 * 60,
  };
};
