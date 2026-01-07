const LEGACY_QUEST_TASKS_ERROR = '旧スキーマの quest_tasks は削除済みです。daily_quest_tasks / daily_quest_snapshots を使用してください。';

export const fetchQuestTasksForUser = async () => {
  throw new Error(LEGACY_QUEST_TASKS_ERROR);
};

export const createQuestTaskForUser = async () => {
  throw new Error(LEGACY_QUEST_TASKS_ERROR);
};

export const updateQuestTaskForUser = async () => {
  throw new Error(LEGACY_QUEST_TASKS_ERROR);
};

export const deleteQuestTaskForUser = async () => {
  throw new Error(LEGACY_QUEST_TASKS_ERROR);
};
