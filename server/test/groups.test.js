import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGroups } from '../src/lib/groups.js';
import { HolidayCalendar } from '../src/lib/holidays.js';
import { buildRoster } from '../src/lib/roster.js';
import { loadGroupMap, readGroupsDoc } from '../src/lib/store.js';

const calendar = HolidayCalendar.load();
const groupMap = loadGroupMap(readGroupsDoc());

test('分组人员：去空格、去重、空成员被丢弃', () => {
  const groups = normalizeGroups([
    { no: 2, name: '二组', backupLeader: ' B ', dutyLeader: 'D', staff: ['a', '', 'a', ' b '] },
    { no: 1, backupLeader: 'A', staff: [] },
  ]);

  assert.equal(groups[0].no, 1);
  assert.equal(groups[0].name, '第1组');
  assert.equal(groups[0].backupLeader, 'A');
  assert.deepEqual(groups[0].staff, []);

  assert.equal(groups[1].no, 2);
  assert.equal(groups[1].backupLeader, 'B');
  assert.deepEqual(groups[1].staff, ['a', 'b']);
});

test('分组人员：组号重复或越界时报错', () => {
  assert.throws(
    () => normalizeGroups([{ no: 1 }, { no: 1 }]),
    /重复/,
  );
  assert.throws(() => normalizeGroups([{ no: 0 }]), /1-10/);
  assert.throws(() => normalizeGroups([{ no: 11 }]), /1-10/);
  assert.throws(() => normalizeGroups(null), /必须是数组/);
});

test('带班领导请假：请假组由代班队列替换，其他组不受影响', () => {
  const roster = buildRoster({
    startDate: '2026-10-31',
    endDate: '2026-11-02',
    schedule: {
      anchorDate: '2026-01-01',
      substitution: {
        enabled: true,
        leaveGroups: [7],
        queue: [1, 2],
        rotationStart: '2026-10-31',
      },
    },
    holidayCalendar: calendar,
    groupMap,
  });

  const leaveDay = roster.days[0];
  assert.equal(leaveDay.date, '2026-10-31');
  assert.equal(leaveDay.groupNo, 7);
  assert.equal(leaveDay.substituted, true);
  assert.equal(leaveDay.backupLeaderGroupNo, 1);
  assert.match(leaveDay.note, /7 组带班领导请长假，由 1 组代班/);

  assert.equal(roster.days[1].substituted, false);
  assert.equal(roster.days[2].substituted, false);
});

test('带班领导请假：代班会跳过请假组与自身', () => {
  const roster = buildRoster({
    startDate: '2026-10-31',
    endDate: '2026-10-31',
    schedule: {
      anchorDate: '2026-01-01',
      substitution: {
        enabled: true,
        leaveGroups: [1, 7],
        queue: [1, 2, 5],
        rotationStart: '2026-10-31',
      },
    },
    holidayCalendar: calendar,
    groupMap,
  });

  const day = roster.days[0];
  assert.equal(day.groupNo, 7);
  assert.equal(day.substituted, true);
  assert.equal(day.backupLeaderGroupNo, 2); // 跳过 1（请假），用 2 组代班
  assert.match(day.note, /由 2 组代班/);
});

test('带班领导请假：取消所有请假组后不再代班', () => {
  const roster = buildRoster({
    startDate: '2026-10-31',
    endDate: '2026-10-31',
    schedule: {
      anchorDate: '2026-01-01',
      substitution: { enabled: true, leaveGroups: [], queue: [1, 2] },
    },
    holidayCalendar: calendar,
    groupMap,
  });

  assert.equal(roster.substitutions.length, 0);
  assert.equal(roster.days[0].substituted, false);
});
