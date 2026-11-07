import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';

import { HolidayCalendar } from '../src/lib/holidays.js';
import { buildRoster } from '../src/lib/roster.js';
import { loadGroupMap } from '../src/lib/store.js';
import { SWAPS_FILE } from '../src/config.js';
import {
  approvedSwaps,
  createRequest,
  deleteRequest,
  handleRequest,
  listRequests,
  summary,
} from '../src/lib/swaps.js';
import { parseRosterWorkbook } from '../src/lib/importWorkbook.js';

const calendar = HolidayCalendar.load();

// 用固定的人员数据，避免测试依赖 src/data/groups.json 的真实名单
const groupMap = new Map();
for (let no = 1; no <= 10; no += 1) {
  groupMap.set(no, {
    no,
    name: `第${no}组`,
    backupLeader: `带班${no}`,
    dutyLeader: `值班${no}`,
    staff: [`干事${no}A`, `干事${no}B`],
  });
}

function rosterOf(startDate, endDate, extra = {}) {
  return buildRoster({
    startDate,
    endDate,
    schedule: { anchorDate: '2026-01-01' },
    holidayCalendar: calendar,
    groupMap,
    ...extra,
  });
}

test('手工设置的值班人员覆盖自动排班结果', () => {
  const roster = rosterOf('2026-11-02', '2026-11-02', {
    assignments: new Map([
      [
        '2026-11-02',
        { date: '2026-11-02', backupLeader: '甲', dutyLeader: '乙', staff: ['丙', '丁'] },
      ],
    ]),
  });
  const day = roster.days[0];
  assert.equal(day.manual, true);
  assert.equal(day.groupNo, 5); // 组号仍保留自动排班结果
  assert.equal(day.backupLeader, '甲');
  assert.equal(day.dutyLeader, '乙');
  assert.equal(day.staffText, '丙、丁');
  assert.equal(roster.meta.manualCount, 1);
});

test('已批准的换班双向替换对应角色并写入备注', () => {
  // 11-02 是第五组、11-03 是第六组
  const swap = {
    id: 'SW-TEST',
    requester: { name: '值班5', date: '2026-11-02', role: 'dutyLeader' },
    target: { name: '值班6', date: '2026-11-03', role: 'dutyLeader' },
  };
  const roster = rosterOf('2026-11-02', '2026-11-03', { swaps: [swap] });
  const [first, second] = roster.days;

  assert.equal(first.dutyLeader, '值班6');
  assert.equal(second.dutyLeader, '值班5');
  assert.equal(first.swapped, true);
  assert.match(first.note, /已批准换班/);
  assert.equal(roster.meta.swapCount, 2);
});

test('工作人员换班在名单内替换', () => {
  // 11-01 是第八组、11-02 是第五组
  const swap = {
    id: 'SW-STAFF',
    requester: { name: '干事5A', date: '2026-11-02', role: 'staff' },
    target: { name: '干事8A', date: '2026-11-01', role: 'staff' },
  };
  const roster = rosterOf('2026-11-01', '2026-11-02', { swaps: [swap] });
  assert.equal(roster.days[0].staffText.includes('干事5A'), true);
  assert.equal(roster.days[1].staffText.includes('干事8A'), true);
});

test('Excel 值班表可被解析为人员安排', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('值班表');
  sheet.addRow(['值班表']);
  sheet.addRow(['序号', '日期', '星期', '带班领导', '值班领导', '工作人员']);
  sheet.addRow([1, '2026-11-05', '周四', '张三', '李四', '王五、赵六']);
  sheet.addRow([2, '2026/11/6', '周五', '甲', '乙', '丙']);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const parsed = await parseRosterWorkbook(buffer);
  assert.equal(parsed.sheetName, '值班表');
  assert.equal(parsed.assignments.length, 2);
  assert.deepEqual(parsed.assignments[0], {
    date: '2026-11-05',
    backupLeader: '张三',
    dutyLeader: '李四',
    staff: ['王五', '赵六'],
  });
  assert.equal(parsed.assignments[1].date, '2026-11-06');
});

test('换班申请：提交、提醒计数、批准生效', () => {
  const backup = fs.existsSync(SWAPS_FILE) ? fs.readFileSync(SWAPS_FILE) : null;
  try {
    fs.rmSync(SWAPS_FILE, { force: true });

    const request = createRequest({
      requester: { name: '张三', date: '2026-11-05', role: 'backupLeader', groupNo: 1 },
      target: { name: '李四', date: '2026-11-06', role: 'dutyLeader', groupNo: 2 },
      reason: '家中有事',
    });
    assert.equal(request.status, 'pending');
    assert.equal(request.requester.roleLabel, '带班领导');

    // 被换班人与管理员都能看到提醒
    assert.equal(summary('李四').pendingAsTarget, 1);
    assert.equal(summary('张三').pendingAsRequester, 1);
    assert.equal(summary('王五').pendingAsTarget, 0);
    assert.equal(summary().pendingTotal, 1);

    // 同一人同一天不能重复提交
    assert.throws(
      () =>
        createRequest({
          requester: { name: '张三', date: '2026-11-05', role: 'backupLeader' },
          target: { name: '赵六', date: '2026-11-07', role: 'staff' },
        }),
      /已提交/,
    );

    handleRequest(request.id, 'approve');
    assert.equal(summary('李四').pendingAsTarget, 0);
    assert.equal(approvedSwaps().length, 1);
    assert.equal(listRequests({ name: '李四' }).length, 1);
    assert.throws(() => handleRequest(request.id, 'approve'), /已处理/);
  } finally {
    if (backup) fs.writeFileSync(SWAPS_FILE, backup);
    else fs.rmSync(SWAPS_FILE, { force: true });
  }
});

test('管理员删除换班申请：记录消失，已批准的换班随之失效', () => {
  const backup = fs.existsSync(SWAPS_FILE) ? fs.readFileSync(SWAPS_FILE) : null;
  try {
    fs.rmSync(SWAPS_FILE, { force: true });

    const request = createRequest({
      requester: { name: '张三', date: '2026-11-05', role: 'backupLeader', groupNo: 1 },
      target: { name: '李四', date: '2026-11-06', role: 'dutyLeader', groupNo: 2 },
    });
    handleRequest(request.id, 'approve');
    assert.equal(approvedSwaps().length, 1);

    const removed = deleteRequest(request.id);
    assert.equal(removed.id, request.id);
    assert.equal(listRequests().length, 0);
    assert.equal(approvedSwaps().length, 0);
    assert.throws(() => deleteRequest(request.id), /不存在/);
  } finally {
    if (backup) fs.writeFileSync(SWAPS_FILE, backup);
    else fs.rmSync(SWAPS_FILE, { force: true });
  }
});

test('换班申请参数校验', () => {
  assert.throws(
    () =>
      createRequest({
        requester: { name: '张三', date: '2026-11-05', role: 'backupLeader' },
        target: { name: '张三', date: '2026-11-06', role: 'dutyLeader' },
      }),
    /不能和自己换班/,
  );
  assert.throws(
    () =>
      createRequest({
        requester: { name: '张三', date: '2026-11-05', role: 'backupLeader' },
        target: { name: '李四', date: '2026-11-05', role: 'dutyLeader' },
      }),
    /日期不能相同/,
  );
});
