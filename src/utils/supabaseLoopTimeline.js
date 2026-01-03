import { supabase } from '../lib/supabaseClient';

const STATE_TABLE = 'loop_timeline_state';
const MARKERS_TABLE = 'loop_timeline_markers';

const nowPerf = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const buildDuration = (start) => Math.round(nowPerf() - start);
const logLoop = (scope, action, phase, detail = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    ...detail,
  };
  const message = `[Supabase:${scope}:${action}] ${phase}`;
  const body = JSON.stringify(payload, null, 2);
  if (phase === 'error') {
    console.error(`${message} ${body}`);
  } else {
    console.info(`${message} ${body}`);
  }
};

export const fetchLoopTimelineStateForUser = async (userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const startedAt = nowPerf();
  logLoop('loopTimeline', 'fetchState', 'request', { userId });

  const { data, error } = await supabase
    .from(STATE_TABLE)
    .select('user_id, duration_minutes, start_at, status, start_delay_minutes, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logLoop('loopTimeline', 'fetchState', 'error', {
      userId,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`ループタイムライン状態を取得できませんでした: ${error.message}`);
  }

  logLoop('loopTimeline', 'fetchState', 'success', {
    userId,
    durationMs: buildDuration(startedAt),
    hasState: !!data,
  });
  return data ?? null;
};

export const saveLoopTimelineStateForUser = async ({ userId, patch }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const safePatch = patch && typeof patch === 'object' ? patch : {};

  const payload = {
    user_id: userId,
    ...safePatch,
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logLoop('loopTimeline', 'saveState', 'request', {
    userId,
    keys: Object.keys(safePatch),
  });

  const { data, error } = await supabase
    .from(STATE_TABLE)
    .upsert(payload, { onConflict: 'user_id' })
    .select('user_id, duration_minutes, start_at, status, start_delay_minutes, created_at, updated_at')
    .single();

  if (error) {
    logLoop('loopTimeline', 'saveState', 'error', {
      userId,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`ループタイムライン状態を保存できませんでした: ${error.message}`);
  }

  logLoop('loopTimeline', 'saveState', 'success', {
    userId,
    durationMs: buildDuration(startedAt),
  });
  return data;
};

export const fetchLoopTimelineMarkersForUser = async (userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const startedAt = nowPerf();
  logLoop('loopTimeline', 'fetchMarkers', 'request', { userId });

  const { data, error } = await supabase
    .from(MARKERS_TABLE)
    .select('id, user_id, text, offset_minutes, created_at, updated_at')
    .eq('user_id', userId)
    .order('offset_minutes', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    logLoop('loopTimeline', 'fetchMarkers', 'error', {
      userId,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`ループタイムラインの追加項目を取得できませんでした: ${error.message}`);
  }

  const list = Array.isArray(data) ? data : [];
  logLoop('loopTimeline', 'fetchMarkers', 'success', {
    userId,
    durationMs: buildDuration(startedAt),
    count: list.length,
  });
  return list;
};

export const createLoopTimelineMarkerForUser = async ({ userId, text, offsetMinutes }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');

  const payload = {
    user_id: userId,
    text: text ?? '',
    offset_minutes: offsetMinutes ?? 0,
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logLoop('loopTimeline', 'createMarker', 'request', {
    userId,
    textLength: String(payload.text).length,
    offsetMinutes: payload.offset_minutes,
  });

  const { data, error } = await supabase
    .from(MARKERS_TABLE)
    .insert(payload)
    .select('id, user_id, text, offset_minutes, created_at, updated_at')
    .single();

  if (error) {
    logLoop('loopTimeline', 'createMarker', 'error', {
      userId,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`ループタイムラインの追加項目を作成できませんでした: ${error.message}`);
  }

  logLoop('loopTimeline', 'createMarker', 'success', {
    userId,
    durationMs: buildDuration(startedAt),
    id: data?.id ?? null,
  });
  return data;
};

export const deleteLoopTimelineMarkerForUser = async ({ userId, id }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (id == null) throw new Error('削除対象IDが指定されていません。');

  const startedAt = nowPerf();
  logLoop('loopTimeline', 'deleteMarker', 'request', { userId, id });

  const { error } = await supabase
    .from(MARKERS_TABLE)
    .delete()
    .eq('user_id', userId)
    .eq('id', id);

  if (error) {
    logLoop('loopTimeline', 'deleteMarker', 'error', {
      userId,
      id,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`ループタイムラインの追加項目を削除できませんでした: ${error.message}`);
  }

  logLoop('loopTimeline', 'deleteMarker', 'success', {
    userId,
    id,
    durationMs: buildDuration(startedAt),
  });
};

export const updateLoopTimelineMarkerForUser = async ({ userId, id, text, offsetMinutes }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (id == null) throw new Error('更新対象IDが指定されていません。');

  const payload = {
    text: text ?? '',
    offset_minutes: offsetMinutes ?? 0,
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logLoop('loopTimeline', 'updateMarker', 'request', {
    userId,
    id,
    textLength: String(payload.text).length,
    offsetMinutes: payload.offset_minutes,
  });

  const { data, error } = await supabase
    .from(MARKERS_TABLE)
    .update(payload)
    .eq('user_id', userId)
    .eq('id', id)
    .select('id, user_id, text, offset_minutes, created_at, updated_at')
    .single();

  if (error) {
    logLoop('loopTimeline', 'updateMarker', 'error', {
      userId,
      id,
      durationMs: buildDuration(startedAt),
      message: error.message,
    });
    throw new Error(`ループタイムラインの追加項目を更新できませんでした: ${error.message}`);
  }

  logLoop('loopTimeline', 'updateMarker', 'success', {
    userId,
    id,
    durationMs: buildDuration(startedAt),
  });
  return data;
};
