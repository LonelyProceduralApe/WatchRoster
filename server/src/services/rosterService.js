import { loadGroupMap, readGroupsDoc, readSchedule } from '../lib/store.js';
import { HolidayCalendar } from '../lib/holidays.js';
import { buildRoster } from '../lib/roster.js';
import { getAssignmentMap } from '../lib/assignments.js';
import { approvedSwaps } from '../lib/swaps.js';
import { HttpError, assertDateKey, assertGroupNo, assertYear } from '../lib/http.js';
import { monthRange } from '../lib/date.js';

function assertMonth(value) {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new HttpError(400, '参数 month 必须是 1-12 的整数', { value });
  }
  return month;
}

/** 解析查询区间：支持 startDate/endDate，也支持 year[&month]，缺省为当前月份 */
export function resolveRange(query = {}) {
  const now = new Date();
  if (query.startDate || query.endDate) {
    const start = query.startDate ?? query.endDate;
    const end = query.endDate ?? query.startDate;
    const startDate = assertDateKey(start, 'startDate');
    const endDate = assertDateKey(end, 'endDate');
    if (startDate > endDate) {
      throw new HttpError(400, 'startDate 不能晚于 endDate', { startDate, endDate });
    }
    return { startDate, endDate };
  }

  if (query.year || query.month) {
    const year = assertYear(query.year ?? now.getFullYear());
    if (query.month) return monthRange(year, assertMonth(query.month));
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  }

  return monthRange(now.getFullYear(), now.getMonth() + 1);
}

function applyOverrides(schedule, query) {
  const next = { ...schedule, substitution: { ...(schedule.substitution ?? {}) } };
  if (query.workdayStartGroup !== undefined) {
    next.workdayStartGroup = assertGroupNo(query.workdayStartGroup, 'workdayStartGroup');
  }
  if (query.weekendStartGroup !== undefined) {
    next.weekendStartGroup = assertGroupNo(query.weekendStartGroup, 'weekendStartGroup');
  }
  if (query.holidayStartGroup !== undefined) {
    next.holidayStartGroup = assertGroupNo(query.holidayStartGroup, 'holidayStartGroup');
  }
  if (query.substitute !== undefined) {
    next.substitution.enabled = !['0', 'false', 'no'].includes(
      String(query.substitute).toLowerCase(),
    );
  }
  return next;
}

export function buildRosterForQuery(query = {}) {
  const { startDate, endDate } = resolveRange(query);
  const schedule = applyOverrides(readSchedule(), query);
  const holidayCalendar = HolidayCalendar.load();
  const groupMap = loadGroupMap(readGroupsDoc());
  return buildRoster({
    startDate,
    endDate,
    schedule,
    holidayCalendar,
    groupMap,
    assignments: getAssignmentMap(),
    swaps: approvedSwaps(),
  });
}
