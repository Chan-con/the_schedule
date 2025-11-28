import { supabase } from '../lib/supabaseClient';

const TABLE_NAME = 'quick_memos';
const nowPerf = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
const buildDuration = (start) => Math.round(nowPerf() - start);
const logMemo = (action, phase, detail = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    ...detail,
  };
  const message = `[Supabase:quickMemo:${action}] ${phase}`;
  const body = JSON.stringify(payload, null, 2);
  if (phase === 'error') {
    console.error(`${message} ${body}`);
  } else {
    console.info(`${message} ${body}`);
  }
};

export const fetchQuickMemoForUser = async (userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const startedAt = nowPerf();
  logMemo('fetch', 'request', { userId });
  const { data, error } = await supabase
    .from(TABLE_NAME)
    .select('content, updated_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    logMemo('fetch', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`クイックメモを取得できませんでした: ${error.message}`);
  }

  const content = data?.content ?? '';
  logMemo('fetch', 'success', {
    userId,
    durationMs: buildDuration(startedAt),
    hasContent: content.length > 0,
  });
  return content;
};

export const saveQuickMemoForUser = async (content, userId) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  const payload = {
    user_id: userId,
    content: content ?? '',
    updated_at: new Date().toISOString(),
  };

  const startedAt = nowPerf();
  logMemo('save', 'request', { userId, length: payload.content.length });
  const { error } = await supabase
    .from(TABLE_NAME)
    .upsert(payload, { onConflict: 'user_id' });

  if (error) {
    logMemo('save', 'error', { userId, durationMs: buildDuration(startedAt), message: error.message });
    throw new Error(`クイックメモを保存できませんでした: ${error.message}`);
  }

  logMemo('save', 'success', {
    userId,
    durationMs: buildDuration(startedAt),
    length: payload.content.length,
  });
};
