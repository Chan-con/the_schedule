import { supabase } from '../lib/supabaseClient';

const TABLE_NAME = 'push_subscriptions';

const pickKeys = (subscription) => {
  const keys = subscription?.keys || {};
  return {
    p256dh: typeof keys.p256dh === 'string' ? keys.p256dh : '',
    auth: typeof keys.auth === 'string' ? keys.auth : '',
  };
};

export const upsertPushSubscriptionForUser = async ({ userId, subscription, userAgent, timezoneOffsetMinutes }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (!subscription?.endpoint) throw new Error('Push購読情報が不正です。');

  const { p256dh, auth } = pickKeys(subscription);
  if (!p256dh || !auth) {
    throw new Error('Push購読情報のキーが不足しています。');
  }

  const payload = {
    user_id: userId,
    endpoint: subscription.endpoint,
    p256dh,
    auth,
    user_agent: typeof userAgent === 'string' ? userAgent : null,
    timezone_offset_minutes:
      typeof timezoneOffsetMinutes === 'number' && Number.isFinite(timezoneOffsetMinutes)
        ? timezoneOffsetMinutes
        : null,
    is_active: true,
    last_seen_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from(TABLE_NAME)
    .upsert(payload, { onConflict: 'user_id,endpoint' })
    .select()
    .single();

  if (error) {
    throw new Error(`Push購読の保存に失敗しました: ${error.message}`);
  }

  return data;
};

export const deactivatePushSubscriptionForUser = async ({ userId, endpoint }) => {
  if (!userId) throw new Error('ユーザーIDが指定されていません。');
  if (!endpoint) throw new Error('endpoint が指定されていません。');

  const { error } = await supabase
    .from(TABLE_NAME)
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('endpoint', endpoint);

  if (error) {
    throw new Error(`Push購読の無効化に失敗しました: ${error.message}`);
  }
};
