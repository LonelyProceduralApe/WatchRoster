import { DAY_TYPE, classifyDay, dayTypeLabel } from './calendar.js';
import {
  addDays,
  diffDays,
  isValidDateKey,
  monthRange,
  rangeKeys,
  weekdayLabel,
  weekdayOf,
} from './date.js';
import { HttpError } from './http.js';
import { MAX_ANCHOR_SPAN_DAYS, MAX_RANGE_DAYS } from '../config.js';

export const GROUP_COUNT = 10;
export const GROUPS_PER_BLOCK = 5;

const DEFAULT_SUBSTITUTION = {
  enabled: false,
  leaveGroups: [3, 4],
  queue: [1, 2, 5, 6, 7, 8, 9, 10],
  startGroup: 1,
  startDate: null,
  endDate: null,
  reason: '请长假',
};

const DEFAULT_SHIFTS = {
  [DAY_TYPE.WORKDAY]: { name: '白班', time: '17:00-次日09:00' },
  [DAY_TYPE.WEEKEND]: { name: '全天班', time: '09:00-次日09:00' },
  [DAY_TYPE.HOLIDAY]: { name: '全天班', time: '09:00-次日09:00' },
};

function normalizeShift(raw, dayType) {
  const fallback = DEFAULT_SHIFTS[dayType];
  return {
    name: raw?.name || fallback.name,
    time: raw?.time || fallback.time,
  };
}

export function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * 工作日序列：每 5 个工作日为一块交给一个大组（1-5 组 / 6-10 组交替），
 * 同一大组每轮再排时，块内起始组顺延 1 位。
 */
export function workdayGroupAt(index, startGroup = 1) {
  const blockIndex = Math.floor(index / GROUPS_PER_BLOCK);
  const position = index % GROUPS_PER_BLOCK;
  const roundIndex = Math.floor(blockIndex / 2);
  const baseStart = mod(Number(startGroup) - 1 + blockIndex * GROUPS_PER_BLOCK, GROUP_COUNT) + 1;
  return mod(baseStart - 1 + mod(roundIndex + position, GROUPS_PER_BLOCK), GROUP_COUNT) + 1;
}

/** 周末 / 节假日序列：按 1→10 循环 */
export function cyclicGroupAt(index, startGroup = 1) {
  return mod(Number(startGroup) - 1 + index, GROUP_COUNT) + 1;
}

function clampGroupNo(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > GROUP_COUNT) return fallback;
  return number;
}

export function normalizeSchedule(raw = {}) {
  const substitutionRaw = { ...DEFAULT_SUBSTITUTION, ...(raw.substitution ?? {}) };
  const leaveGroups = (Array.isArray(substitutionRaw.leaveGroups)
    ? substitutionRaw.leaveGroups
    : DEFAULT_SUBSTITUTION.leaveGroups
  )
    .map(Number)
    .filter((no) => Number.isInteger(no) && no >= 1 && no <= GROUP_COUNT);
  // 代班队列 = 1-10 中未请假的组，按组号顺序轮转；
  // 之前依赖配置里的 queue，请假组增减后队列不会同步，会出现「跳过某组」的情况
  const queue = Array.from({ length: GROUP_COUNT }, (_, index) => index + 1).filter(
    (no) => !leaveGroups.includes(no),
  );

  const shiftsRaw = raw.shifts ?? {};
  // 兼容旧配置：只配了 anchorDate 时，三条线共用这个起排日期
  const legacyAnchor = isValidDateKey(raw.anchorDate) ? raw.anchorDate : null;
  const pickAnchor = (value) => (isValidDateKey(value) ? value : legacyAnchor);

  // 起始组必须落在队列内，否则从队列首位开始
  const pickStartGroup = (value) => {
    const picked = clampGroupNo(value, queue[0] ?? 1);
    return queue.includes(picked) ? picked : (queue[0] ?? 1);
  };
  // 兼容旧配置：只有单个 startGroup / rotationStart 时三条序列共用
  const startGroup = pickStartGroup(substitutionRaw.startGroup);
  const rotationStart = isValidDateKey(substitutionRaw.rotationStart)
    ? substitutionRaw.rotationStart
    : null;
  const startGroupsRaw = substitutionRaw.startGroups ?? {};
  const rotationStartsRaw = substitutionRaw.rotationStarts ?? {};
  const startGroups = {
    [DAY_TYPE.WORKDAY]: pickStartGroup(startGroupsRaw[DAY_TYPE.WORKDAY] ?? startGroup),
    [DAY_TYPE.WEEKEND]: pickStartGroup(startGroupsRaw[DAY_TYPE.WEEKEND] ?? startGroup),
    [DAY_TYPE.HOLIDAY]: pickStartGroup(startGroupsRaw[DAY_TYPE.HOLIDAY] ?? startGroup),
  };
  const rotationStarts = {
    [DAY_TYPE.WORKDAY]: isValidDateKey(rotationStartsRaw[DAY_TYPE.WORKDAY])
      ? rotationStartsRaw[DAY_TYPE.WORKDAY]
      : rotationStart,
    [DAY_TYPE.WEEKEND]: isValidDateKey(rotationStartsRaw[DAY_TYPE.WEEKEND])
      ? rotationStartsRaw[DAY_TYPE.WEEKEND]
      : rotationStart,
    [DAY_TYPE.HOLIDAY]: isValidDateKey(rotationStartsRaw[DAY_TYPE.HOLIDAY])
      ? rotationStartsRaw[DAY_TYPE.HOLIDAY]
      : rotationStart,
  };

  return {
    anchors: {
      [DAY_TYPE.WORKDAY]: pickAnchor(raw.workdayAnchorDate),
      [DAY_TYPE.WEEKEND]: pickAnchor(raw.weekendAnchorDate),
      [DAY_TYPE.HOLIDAY]: pickAnchor(raw.holidayAnchorDate),
    },
    workdayStartGroup: clampGroupNo(raw.workdayStartGroup, 1),
    weekendStartGroup: clampGroupNo(raw.weekendStartGroup, 1),
    holidayStartGroup: clampGroupNo(raw.holidayStartGroup, 1),
    shifts: {
      [DAY_TYPE.WORKDAY]: normalizeShift(shiftsRaw[DAY_TYPE.WORKDAY], DAY_TYPE.WORKDAY),
      [DAY_TYPE.WEEKEND]: normalizeShift(shiftsRaw[DAY_TYPE.WEEKEND], DAY_TYPE.WEEKEND),
      [DAY_TYPE.HOLIDAY]: normalizeShift(shiftsRaw[DAY_TYPE.HOLIDAY], DAY_TYPE.HOLIDAY),
    },
    substitution: {
      enabled: Boolean(substitutionRaw.enabled) && leaveGroups.length > 0 && queue.length > 0,
      leaveGroups,
      queue,
      startGroup,
      rotationStart,
      startGroups,
      rotationStarts,
      startDate: isValidDateKey(substitutionRaw.startDate) ? substitutionRaw.startDate : null,
      endDate: isValidDateKey(substitutionRaw.endDate) ? substitutionRaw.endDate : null,
      reason: substitutionRaw.reason || DEFAULT_SUBSTITUTION.reason,
    },
  };
}

/**
 * 从代班队列取一个可用的组：跳过与自己相同、以及同样请假的组。
 * 每代一次队列前进一位，跳过的候选不再复用。
 */
function pickBackupGroup(substitution, groupNo, cursor) {
  const queue = substitution.queue;
  const eligible = (no) => no !== groupNo && !substitution.leaveGroups.includes(no);
  for (let step = 0; step < queue.length; step += 1) {
    const candidate = queue[(cursor + step) % queue.length];
    if (eligible(candidate)) {
      return { groupNo: candidate, nextCursor: cursor + step + 1 };
    }
  }
  return null;
}

function inLeaveWindow(key, substitution) {
  if (substitution.startDate && key < substitution.startDate) return false;
  if (substitution.endDate && key > substitution.endDate) return false;
  return true;
}

function resolveGroup(groupMap, groupNo) {
  const group = groupMap?.get?.(groupNo);
  return {
    no: groupNo,
    name: group?.name ?? `第${groupNo}组`,
    backupLeader: group?.backupLeader ?? '',
    dutyLeader: group?.dutyLeader ?? '',
    staff: Array.isArray(group?.staff) ? [...group.staff] : [],
  };
}

const ROLE_LABELS = { backupLeader: '带班领导', dutyLeader: '值班领导', staff: '工作人员' };

/** 把已批准的换班应用到某一天 */
function applySwapToDay(day, key, swap) {
  const sides = [
    { from: swap.requester, to: swap.target },
    { from: swap.target, to: swap.requester },
  ];
  for (const { from, to } of sides) {
    if (!from || !to || from.date !== key) continue;

    if (from.role === 'staff') {
      const index = day.staff.indexOf(from.name);
      if (index < 0) continue;
      day.staff[index] = to.name;
      day.staffText = day.staff.join('、');
    } else {
      if (day[from.role] !== from.name) continue;
      day[from.role] = to.name;
    }
    day.swapped = true;
    day.swapNotes.push(
      `已批准换班：${from.name} → ${to.name}（${ROLE_LABELS[from.role] ?? from.role}）`,
    );
  }
}

/** 统计某日期区间内某一类型的天数（含首尾） */
function countDayType(fromKey, toKey, dayType, holidayCalendar) {
  if (fromKey > toKey) return 0;
  let total = 0;
  for (const key of rangeKeys(fromKey, toKey)) {
    if (classifyDay(key, holidayCalendar.getDay(key)) === dayType) total += 1;
  }
  return total;
}

/**
 * 生成排班表。
 * 三条序列各有独立起排日期与起始组，任意子区间查询得到的结果与整段生成保持一致。
 */
export function buildRoster({
  startDate,
  endDate,
  schedule,
  holidayCalendar,
  groupMap,
  assignments = new Map(),
  swaps = [],
}) {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate)) {
    throw new HttpError(400, 'startDate / endDate 必须是 YYYY-MM-DD');
  }
  if (startDate > endDate) {
    throw new HttpError(400, 'startDate 不能晚于 endDate', { startDate, endDate });
  }
  const spanDays = diffDays(startDate, endDate) + 1;
  if (spanDays > MAX_RANGE_DAYS) {
    throw new HttpError(400, `单次查询不能超过 ${MAX_RANGE_DAYS} 天`, { spanDays });
  }

  const config = normalizeSchedule(schedule);

  // 三条序列各自的起排日期；未配置时以查询起始日为起点
  const anchors = {
    [DAY_TYPE.WORKDAY]: config.anchors[DAY_TYPE.WORKDAY] ?? startDate,
    [DAY_TYPE.WEEKEND]: config.anchors[DAY_TYPE.WEEKEND] ?? startDate,
    [DAY_TYPE.HOLIDAY]: config.anchors[DAY_TYPE.HOLIDAY] ?? startDate,
  };

  // 代班队列的推演起点：各序列的轮转起始日 > 请假开始日 > 最早的起排日期
  const substitution = config.substitution;
  const defaultSubstitutionOrigin = [
    anchors[DAY_TYPE.WORKDAY],
    anchors[DAY_TYPE.WEEKEND],
    anchors[DAY_TYPE.HOLIDAY],
  ].sort()[0];
  const substitutionOrigins = {
    [DAY_TYPE.WORKDAY]:
      substitution.rotationStarts[DAY_TYPE.WORKDAY] ??
      substitution.startDate ??
      defaultSubstitutionOrigin,
    [DAY_TYPE.WEEKEND]:
      substitution.rotationStarts[DAY_TYPE.WEEKEND] ??
      substitution.startDate ??
      defaultSubstitutionOrigin,
    [DAY_TYPE.HOLIDAY]:
      substitution.rotationStarts[DAY_TYPE.HOLIDAY] ??
      substitution.startDate ??
      defaultSubstitutionOrigin,
  };

  // 从最早的起点开始推演，才能算出查询起始日时各序列已排到第几个
  const walkFrom = [
    anchors[DAY_TYPE.WORKDAY],
    anchors[DAY_TYPE.WEEKEND],
    anchors[DAY_TYPE.HOLIDAY],
    startDate,
    ...Object.values(substitutionOrigins),
  ].sort()[0];

  const walkSpan = diffDays(walkFrom, endDate) + 1;
  if (walkSpan > MAX_ANCHOR_SPAN_DAYS) {
    throw new HttpError(400, `起排日期到查询结束日期跨度过大（上限 ${MAX_ANCHOR_SPAN_DAYS} 天）`, {
      anchors,
      endDate,
    });
  }

  // 初始化三条序列在 walkFrom 处的序号（起排日之前的日期按周期向前推演）
  const counters = { [DAY_TYPE.WORKDAY]: 0, [DAY_TYPE.WEEKEND]: 0, [DAY_TYPE.HOLIDAY]: 0 };
  for (const dayType of Object.values(DAY_TYPE)) {
    const anchor = anchors[dayType];
    counters[dayType] =
      walkFrom >= anchor
        ? countDayType(anchor, addDays(walkFrom, -1), dayType, holidayCalendar)
        : -countDayType(walkFrom, addDays(anchor, -1), dayType, holidayCalendar);
  }

  // 工作日 / 周末 / 节假日三条序列各自维护代班游标，互不占用；
  // 到达各自的「代班起排日期」时重置为该序列配置的起始组
  const rotationCursors = {
    [DAY_TYPE.WORKDAY]: Math.max(0, substitution.queue.indexOf(substitution.startGroups[DAY_TYPE.WORKDAY])),
    [DAY_TYPE.WEEKEND]: Math.max(0, substitution.queue.indexOf(substitution.startGroups[DAY_TYPE.WEEKEND])),
    [DAY_TYPE.HOLIDAY]: Math.max(0, substitution.queue.indexOf(substitution.startGroups[DAY_TYPE.HOLIDAY])),
  };
  const backupCursors = { [DAY_TYPE.WORKDAY]: 0, [DAY_TYPE.WEEKEND]: 0, [DAY_TYPE.HOLIDAY]: 0 };

  const days = [];
  const groupStats = new Map();
  const substitutions = [];
  const unverifiedYears = new Set();

  for (const key of rangeKeys(walkFrom, endDate)) {
    const dayInfo = holidayCalendar.getDay(key);
    const dayType = classifyDay(key, dayInfo);
    const sequenceIndex = counters[dayType];
    counters[dayType] += 1;

    if (!dayInfo.verified) unverifiedYears.add(Number(key.slice(0, 4)));

    const groupNo =
      dayType === DAY_TYPE.WORKDAY
        ? workdayGroupAt(sequenceIndex, config.workdayStartGroup)
        : cyclicGroupAt(
            sequenceIndex,
            dayType === DAY_TYPE.WEEKEND ? config.weekendStartGroup : config.holidayStartGroup,
          );

    const inRange = key >= startDate;

    const group = resolveGroup(groupMap, groupNo);
    let backupGroupNo = groupNo;
    let substitutionRecord = null;

    for (const cursorType of Object.values(DAY_TYPE)) {
      if (key === substitutionOrigins[cursorType]) backupCursors[cursorType] = rotationCursors[cursorType];
    }

    if (
      substitution.enabled &&
      substitution.leaveGroups.includes(groupNo) &&
      inLeaveWindow(key, substitution)
    ) {
      const picked = pickBackupGroup(substitution, groupNo, backupCursors[dayType]);
      if (picked) {
        backupCursors[dayType] = picked.nextCursor;
        backupGroupNo = picked.groupNo;
        substitutionRecord = {
          fromGroupNo: groupNo,
          byGroupNo: picked.groupNo,
          reason: substitution.reason,
          note: `${groupNo} 组带班领导${substitution.reason}，由 ${picked.groupNo} 组代班`,
        };
        if (inRange) substitutions.push({ date: key, ...substitutionRecord });
      }
    }

    if (!inRange) continue;

    const backupGroup = resolveGroup(groupMap, backupGroupNo);
    const day = {
      date: key,
      weekday: weekdayLabel(key),
      weekdayNo: weekdayOf(key),
      dayType,
      dayTypeLabel: dayTypeLabel(dayType, dayInfo),
      holidayName: dayInfo.holidayName,
      isMakeupWorkday: dayInfo.isMakeupWorkday,
      shiftName: config.shifts[dayType].name,
      shiftTime: config.shifts[dayType].time,
      groupNo,
      groupName: group.name,
      backupLeader: backupGroup.backupLeader,
      backupLeaderGroupNo: backupGroupNo,
      dutyLeader: group.dutyLeader,
      staff: group.staff,
      staffText: group.staff.join('、'),
      substituted: Boolean(substitutionRecord),
      substitution: substitutionRecord,
      note: substitutionRecord ? substitutionRecord.note : '',
      verified: dayInfo.verified,
      manual: false,
      swapped: false,
      swapNotes: [],
    };

    // 手工设置的值班人员优先于自动排班结果
    const assignment = assignments?.get?.(key);
    if (assignment) {
      day.backupLeader = assignment.backupLeader || day.backupLeader;
      day.dutyLeader = assignment.dutyLeader || day.dutyLeader;
      if (Array.isArray(assignment.staff) && assignment.staff.length > 0) {
        day.staff = [...assignment.staff];
      }
      day.staffText = day.staff.join('、');
      day.manual = true;
    }

    // 已批准的换班覆盖对应角色
    for (const swap of swaps) {
      applySwapToDay(day, key, swap);
    }
    day.note = [day.note, ...day.swapNotes].filter(Boolean).join('；');

    days.push(day);

    if (!groupStats.has(groupNo)) {
      groupStats.set(groupNo, {
        groupNo,
        groupName: group.name,
        workday: 0,
        weekend: 0,
        holiday: 0,
        total: 0,
        backupDutyDays: 0,
      });
    }
    const stat = groupStats.get(groupNo);
    stat[dayType] += 1;
    stat.total += 1;
    if (substitutionRecord) {
      const byStat = groupStats.get(backupGroupNo) ?? {
        groupNo: backupGroupNo,
        groupName: backupGroup.name,
        workday: 0,
        weekend: 0,
        holiday: 0,
        total: 0,
        backupDutyDays: 0,
      };
      groupStats.set(backupGroupNo, byStat);
      byStat.backupDutyDays += 1;
    }
  }

  const warnings = [...unverifiedYears]
    .sort((a, b) => a - b)
    .map(
      (year) =>
        `${year} 年没有官方节假日数据，已按固定公历节日兜底计算，请补录 ${year}.json 后重新排班`,
    );

  return {
    meta: {
      startDate,
      endDate,
      anchors,
      generatedAt: new Date().toISOString(),
      dayCount: days.length,
      schedule: config,
      dayTypeCount: { ...counters },
      substitutionCount: substitutions.length,
      manualCount: days.filter((day) => day.manual).length,
      swapCount: days.filter((day) => day.swapped).length,
      warnings,
    },
    days,
    substitutions,
    stats: {
      groups: [...groupStats.values()].sort((a, b) => a.groupNo - b.groupNo),
    },
  };
}

/** 只算日期分类的轻量日历视图 */
export function buildCalendar({ year, month = null, holidayCalendar }) {
  const { startDate, endDate } = month
    ? monthRange(year, month)
    : { startDate: `${year}-01-01`, endDate: `${year}-12-31` };

  const days = rangeKeys(startDate, endDate).map((key) => {
    const info = holidayCalendar.getDay(key);
    const dayType = classifyDay(key, info);
    return {
      date: key,
      weekday: weekdayLabel(key),
      dayType,
      dayTypeLabel: dayTypeLabel(dayType, info),
      holidayName: info.holidayName,
      isMakeupWorkday: info.isMakeupWorkday,
    };
  });

  const summary = { workday: 0, weekend: 0, holiday: 0 };
  for (const day of days) summary[day.dayType] += 1;

  return { year, month, startDate, endDate, summary, days };
}
