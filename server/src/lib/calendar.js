import { isWeekendKey } from './date.js';

export const DAY_TYPE = {
  WORKDAY: 'workday',
  WEEKEND: 'weekend',
  HOLIDAY: 'holiday',
};

export const DAY_TYPE_LABELS = {
  [DAY_TYPE.WORKDAY]: '工作日',
  [DAY_TYPE.WEEKEND]: '周末',
  [DAY_TYPE.HOLIDAY]: '节假日',
};

/**
 * 日期分类，优先级：节假日 > 工作日（含调休补班）> 周末
 */
export function classifyDay(key, dayInfo) {
  if (dayInfo?.isHoliday) return DAY_TYPE.HOLIDAY;
  if (isWeekendKey(key)) {
    return dayInfo?.isMakeupWorkday ? DAY_TYPE.WORKDAY : DAY_TYPE.WEEKEND;
  }
  return DAY_TYPE.WORKDAY;
}

export function dayTypeLabel(dayType, { holidayName = null, isMakeupWorkday = false } = {}) {
  const base = DAY_TYPE_LABELS[dayType] ?? dayType;
  if (dayType === DAY_TYPE.HOLIDAY && holidayName) return `${base}（${holidayName}）`;
  if (dayType === DAY_TYPE.WORKDAY && isMakeupWorkday) return `${base}（调休补班）`;
  return base;
}
