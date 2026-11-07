import test from 'node:test';
import assert from 'node:assert/strict';

import { HolidayCalendar } from '../src/lib/holidays.js';
import { buildRoster, cyclicGroupAt, normalizeSchedule, workdayGroupAt } from '../src/lib/roster.js';
import { buildWorkbookBuffer } from '../src/lib/excel.js';
import { loadGroupMap } from '../src/lib/store.js';

const calendar = HolidayCalendar.load();
const groupMap = loadGroupMap({ groups: [] });

const SUBSTITUTION = {
  enabled: true,
  leaveGroups: [3, 4],
  queue: [1, 2, 5, 6, 7, 8, 9, 10],
};

function makeRoster(startDate, endDate, rawSchedule = {}) {
  return buildRoster({
    startDate,
    endDate,
    schedule: { anchorDate: startDate, ...rawSchedule },
    holidayCalendar: calendar,
    groupMap,
  });
}

test('工作日序列与 README 示例一致（起点 1）', () => {
  const expected = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 2, 3, 4, 5, 1, 7, 8, 9, 10, 6];
  const actual = expected.map((_, index) => workdayGroupAt(index, 1));
  assert.deepEqual(actual, expected);
});

test('工作日序列支持任意起点组号', () => {
  // 起点 6：先排 6-10 组，再排 1-5 组
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => workdayGroupAt(index, 6)),
    [6, 7, 8, 9, 10, 1, 2, 3, 4, 5],
  );
});

test('周末 / 节假日序列按 1→10 循环', () => {
  assert.deepEqual(
    Array.from({ length: 12 }, (_, index) => cyclicGroupAt(index, 1)),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1, 2],
  );
  assert.equal(cyclicGroupAt(0, 10), 10);
  assert.equal(cyclicGroupAt(1, 10), 1);
});

test('日期分类：调休补班算工作日，假期内周末算节假日', () => {
  const roster = makeRoster('2026-01-01', '2026-01-11');
  const byDate = new Map(roster.days.map((day) => [day.date, day]));

  assert.equal(byDate.get('2026-01-01').dayType, 'holiday'); // 元旦
  assert.equal(byDate.get('2026-01-03').dayType, 'holiday'); // 假期内周六
  assert.equal(byDate.get('2026-01-04').dayType, 'workday'); // 调休补班（周日）
  assert.equal(byDate.get('2026-01-05').dayType, 'workday');
  assert.equal(byDate.get('2026-01-10').dayType, 'weekend');
  assert.equal(byDate.get('2026-01-11').dayType, 'weekend');
});

test('三条序列各自独立推进', () => {
  const roster = makeRoster('2026-01-01', '2026-01-11', { substitution: { enabled: false } });
  const groupByDate = Object.fromEntries(roster.days.map((day) => [day.date, day.groupNo]));

  // 节假日序列 1,2,3
  assert.equal(groupByDate['2026-01-01'], 1);
  assert.equal(groupByDate['2026-01-02'], 2);
  assert.equal(groupByDate['2026-01-03'], 3);
  // 工作日序列：补班日 01-04 起算，1..5 后进入 6-10 大组
  assert.equal(groupByDate['2026-01-04'], 1);
  assert.equal(groupByDate['2026-01-08'], 5);
  assert.equal(groupByDate['2026-01-09'], 6);
  // 周末序列独立从 1 开始
  assert.equal(groupByDate['2026-01-10'], 1);
  assert.equal(groupByDate['2026-01-11'], 2);
});

test('块可以跨自然周，不足 5 天不借组也不作废', () => {
  // 2026-11 的 11/1 是周日，11/2-11/6 为完整工作日块
  const roster = makeRoster('2026-10-26', '2026-11-13', { substitution: { enabled: false } });
  const workdays = roster.days.filter((day) => day.dayType === 'workday');
  for (let index = 0; index < workdays.length; index += 1) {
    assert.equal(workdays[index].groupNo, workdayGroupAt(index, 1));
  }
  // 第一个块正好 5 天，第二个块同样 5 天，保证不因跨周而错位
  assert.equal(workdays[4].groupNo, 5);
  assert.equal(workdays[5].groupNo, 6);
});

test('任意子区间查询结果与整段生成一致（序列从起排日期连续推进）', () => {
  const full = makeRoster('2026-11-01', '2026-11-30', { anchorDate: '2026-01-01' });
  const part = makeRoster('2026-11-16', '2026-11-30', { anchorDate: '2026-01-01' });
  const fullMap = new Map(full.days.map((day) => [day.date, day.groupNo]));
  for (const day of part.days) {
    assert.equal(day.groupNo, fullMap.get(day.date), `${day.date} 组号应保持一致`);
  }
});

test('带班领导代班：三条序列各自排队，每次前进一位', () => {
  const roster = makeRoster('2026-01-01', '2026-01-11', { substitution: SUBSTITUTION });
  assert.deepEqual(
    roster.substitutions.map((item) => [item.date, item.fromGroupNo, item.byGroupNo]),
    [
      ['2026-01-03', 3, 1], // 节假日序列第 1 代
      ['2026-01-06', 3, 1], // 工作日序列第 1 代（与节假日互不占用）
      ['2026-01-07', 4, 2], // 工作日序列第 2 代
    ],
  );
  const substituted = roster.days.find((day) => day.date === '2026-01-06');
  assert.equal(substituted.groupNo, 3);
  assert.equal(substituted.backupLeaderGroupNo, 1);
  assert.equal(substituted.note, '3 组带班领导请长假，由 1 组代班');
  assert.equal(substituted.substituted, true);
});

test('代班起始组按序列分别配置，互不影响', () => {
  const roster = makeRoster('2026-01-01', '2026-01-11', {
    substitution: {
      enabled: true,
      leaveGroups: [3, 4],
      startGroups: { workday: 2, holiday: 5 },
    },
  });

  assert.deepEqual(
    roster.substitutions.map((item) => [item.date, item.fromGroupNo, item.byGroupNo]),
    [
      ['2026-01-03', 3, 5], // 节假日从第 5 组开始
      ['2026-01-06', 3, 2], // 工作日从第 2 组开始
      ['2026-01-07', 4, 5], // 工作日第 2 代，队列按 1、2、5、6、7、8、9、10 前进
    ],
  );
});

test('代班可通过开关关闭，非放假组不受影响', () => {
  const roster = makeRoster('2026-01-01', '2026-01-11', {
    substitution: { ...SUBSTITUTION, enabled: false },
  });
  assert.equal(roster.substitutions.length, 0);
  assert.ok(roster.days.every((day) => day.substituted === false));
});

test('未配置节假日数据的年份给出兜底与告警', () => {
  const roster = makeRoster('2027-01-01', '2027-01-05');
  assert.ok(roster.meta.warnings.some((warning) => warning.includes('2027')));
  assert.equal(roster.days[0].dayType, 'holiday'); // 元旦兜底
  assert.equal(roster.days[0].verified, false);
});

test('normalizeSchedule 收敛非法配置', () => {
  const config = normalizeSchedule({
    anchorDate: '2026-13-01',
    workdayStartGroup: 11,
    substitution: { enabled: true, leaveGroups: [] },
  });
  assert.equal(config.anchors.workday, null);
  assert.equal(config.anchors.weekend, null);
  assert.equal(config.anchors.holiday, null);
  assert.equal(config.workdayStartGroup, 1);
  assert.equal(config.substitution.enabled, false); // 没有请假组时代班关闭
  assert.deepEqual(config.substitution.queue, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('Excel 导出可生成有效 xlsx', async () => {
  const roster = makeRoster('2026-11-01', '2026-11-30', { substitution: SUBSTITUTION });
  const buffer = await buildWorkbookBuffer(roster);
  assert.ok(buffer.byteLength > 5000);
  assert.equal(Buffer.from(buffer).subarray(0, 2).toString(), 'PK');
});

test('超长区间与倒置区间被拒绝', () => {
  assert.throws(() => makeRoster('2026-01-01', '2027-12-31'), /不能超过/);
  assert.throws(() => makeRoster('2026-02-01', '2026-01-01'), /不能晚于/);
});
