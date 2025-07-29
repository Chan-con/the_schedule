// 祝日機能のテスト用スクリプト
import { isJapaneseHoliday, getJapaneseHolidayName, getJapaneseHolidaysOfYear } from './src/utils/holidays.js';

// 2025年の祝日をテスト
const year = 2025;
console.log(`${year}年の祝日一覧:`);

const holidays = getJapaneseHolidaysOfYear(year);
holidays.forEach(holiday => {
  console.log(`${holiday.date}: ${holiday.name}`, holiday);
});

// 特定の日付をテスト
const testDates = [
  new Date(2025, 0, 1),  // 元日
  new Date(2025, 6, 21), // 海の日（2025年は7月21日）
  new Date(2025, 7, 11), // 山の日
  new Date(2025, 8, 15), // 敬老の日（2025年は9月15日）
  new Date(2025, 6, 30), // 普通の日
];

testDates.forEach(date => {
  const isHoliday = isJapaneseHoliday(date);
  const holidayName = getJapaneseHolidayName(date);
  console.log(`${date.toLocaleDateString('ja-JP')}: ${isHoliday ? '祝日' : '平日'} ${holidayName || ''}`);
});
