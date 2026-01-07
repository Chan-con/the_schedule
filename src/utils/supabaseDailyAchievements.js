const LEGACY_DAILY_ACHIEVEMENTS_ERROR = '旧スキーマの daily_achievements は削除済みです。daily_quest_snapshots を使用してください。';

export const fetchDailyAchievementsForUserInRange = async () => {
  throw new Error(LEGACY_DAILY_ACHIEVEMENTS_ERROR);
};

export const upsertDailyAchievementForUser = async () => {
  throw new Error(LEGACY_DAILY_ACHIEVEMENTS_ERROR);
};

export const deletePendingDailyAchievementForUser = async () => {
  throw new Error(LEGACY_DAILY_ACHIEVEMENTS_ERROR);
};

export const confirmDailyAchievementsBeforeDate = async () => {
  throw new Error(LEGACY_DAILY_ACHIEVEMENTS_ERROR);
};
