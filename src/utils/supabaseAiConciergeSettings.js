import { supabase } from '../lib/supabaseClient';

const TABLE = 'ai_concierge_settings';

// NOTE:
// APIキーは平文で扱わない方針のため、このファイルではキーの読み書きは行いません。
// 取得/保存は AIエンドポイント（worker）経由で行います。

export const fetchAiConciergeApiKeyStatusForUser = async ({ userId }) => {
  if (!userId) {
    throw new Error('userId is required.');
  }

  const { data, error } = await supabase
    .from(TABLE)
    .select('openai_api_key_ciphertext')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const saved = !!(typeof data?.openai_api_key_ciphertext === 'string' && data.openai_api_key_ciphertext.trim());
  return { saved };
};
