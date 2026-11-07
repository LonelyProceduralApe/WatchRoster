const DAY_MS = 86400000;

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}

export function isValidDateKey(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [year, month, day] = key.split('-').map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function toDateKey(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function parseDateKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function addDays(key, amount) {
  return toDateKey(new Date(parseDateKey(key).getTime() + amount * DAY_MS));
}

export function diffDays(fromKey, toKey) {
  return Math.round((parseDateKey(toKey).getTime() - parseDateKey(fromKey).getTime()) / DAY_MS);
}

/** 0 = 周日 ... 6 = 周六 */
export function weekdayOf(key) {
  return parseDateKey(key).getUTCDay();
}

export function isWeekendKey(key) {
  const weekday = weekdayOf(key);
  return weekday === 0 || weekday === 6;
}

export function weekdayLabel(key) {
  return WEEKDAY_LABELS[weekdayOf(key)];
}

/** 生成 [fromKey, toKey] 闭区间的所有日期（ISO 字符串可以直接比较大小） */
export function rangeKeys(fromKey, toKey) {
  const total = diffDays(fromKey, toKey);
  if (total < 0) return [];
  const keys = new Array(total + 1);
  for (let index = 0; index <= total; index += 1) {
    keys[index] = addDays(fromKey, index);
  }
  return keys;
}

export function monthRange(year, month) {
  const firstDay = `${year}-${pad2(month)}-01`;
  const lastDay = toDateKey(new Date(Date.UTC(year, month, 0)));
  return { startDate: firstDay, endDate: lastDay };
}

export function formatCnDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

export function todayKey(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}
