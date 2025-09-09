// 日付ユーティリティ（ローカルタイム基準）
export const toDateStrLocal = (date) => {
  if (!(date instanceof Date)) return '';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const fromDateStrLocal = (dateStr) => {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const [y, m, d] = dateStr.split('-').map((v) => parseInt(v, 10));
  if (!y || !m || !d) return null;
  // ローカルタイムの 00:00:00 として生成
  return new Date(y, m - 1, d);
};
