import JapaneseHolidays from 'japanese-holidays';

/**
 * 指定した日付が日本の祝日かどうかを判定する
 * @param {Date} date - 判定する日付
 * @returns {boolean} 祝日の場合はtrue
 */
export const isJapaneseHoliday = (date) => {
  try {
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // JavaScriptの月は0ベース
    const day = date.getDate();
    
    const holidays = JapaneseHolidays.getHolidaysOf(year);
    
    return holidays.some(holiday => {
      return holiday.month === month && holiday.date === day;
    });
  } catch (error) {
    console.error('祝日判定でエラーが発生しました:', error);
    return false;
  }
};

/**
 * 指定した日付の祝日名を取得する
 * @param {Date} date - 判定する日付
 * @returns {string|null} 祝日名、祝日でない場合はnull
 */
export const getJapaneseHolidayName = (date) => {
  try {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    
    const holidays = JapaneseHolidays.getHolidaysOf(year);
    
    const holiday = holidays.find(holiday => {
      return holiday.month === month && holiday.date === day;
    });
    
    return holiday ? holiday.name : null;
  } catch (error) {
    console.error('祝日名取得でエラーが発生しました:', error);
    return null;
  }
};

/**
 * 指定した年の全祝日を取得する
 * @param {number} year - 年
 * @returns {Array} 祝日の配列
 */
export const getJapaneseHolidaysOfYear = (year) => {
  try {
    return JapaneseHolidays.getHolidaysOf(year);
  } catch (error) {
    console.error('年間祝日取得でエラーが発生しました:', error);
    return [];
  }
};
