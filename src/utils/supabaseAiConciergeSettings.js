import { supabase } from '../lib/supabaseClient';

const TABLE = 'ai_concierge_settings';

export const fetchAiConciergeApiKeyForUser = async ({ userId }) => {
  if (!userId) {
    throw new Error('userId is required.');
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select('openai_api_key')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const value = typeof data?.openai_api_key === 'string' ? data.openai_api_key : '';
  return value;
};

export const upsertAiConciergeApiKeyForUser = async ({ userId, apiKey }) => {
  if (!userId) {
    throw new Error('userId is required.');
  }

  const value = typeof apiKey === 'string' ? apiKey : '';

  const { error } = await supabase
    .from(TABLE)
    .upsert(
      {
        user_id: userId,
        openai_api_key: value,
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    throw error;
  }
};

export const clearAiConciergeApiKeyForUser = async ({ userId }) => {
  if (!userId) {
    throw new Error('userId is required.');
  }

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('user_id', userId);

  if (error) {
    throw error;
  }
};
