import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';

import { buildTemplateBuffer } from '../src/lib/excel.js';
import { buildRoster } from '../src/lib/roster.js';
import { HolidayCalendar } from '../src/lib/holidays.js';
import { loadGroupMap } from '../src/lib/store.js';

const calendar = HolidayCalendar.load();
const groupMap = loadGroupMap({ groups: [] });

function rosterOf(startDate, endDate, schedule) {
  return buildRoster({
    startDate,
    endDate,
    schedule: { substitution: { enabled: false }, ...schedule },
    holidayCalendar: calendar,
    groupMap,
  });
}

test('起排日期与三条序列的起始组分别生效', () => {
  const roster = rosterOf('2026-11-01', '2026-11-03', {
    anchorDate: '2026-11-01',
    workdayStartGroup: 4,
    weekendStartGroup: 7,
    holidayStartGroup: 9,
  });

  // 11-01 周日走周末序列，11-02/03 走工作日序列
  assert.equal(roster.days[0].dayType, 'weekend');
  assert.equal(roster.days[0].groupNo, 7);
  assert.equal(roster.days[1].dayType, 'workday');
  assert.equal(roster.days[1].groupNo, 4);
  assert.equal(roster.days[2].groupNo, 5);
});

test('节假日序列起始组生效', () => {
  const roster = rosterOf('2026-10-01', '2026-10-02', {
    anchorDate: '2026-10-01',
    holidayStartGroup: 9,
  });

  assert.equal(roster.days[0].dayType, 'holiday');
  assert.equal(roster.days[0].groupNo, 9);
  assert.equal(roster.days[1].groupNo, 10);
});

test('换起排日期后同一日期组号随之改变', () => {
  const first = rosterOf('2026-11-02', '2026-11-02', { anchorDate: '2026-01-01' });
  const second = rosterOf('2026-11-02', '2026-11-02', { anchorDate: '2026-11-02' });

  assert.equal(second.days[0].groupNo, 1); // 从当天起排，第一个工作日给第 1 组
  assert.notEqual(first.days[0].groupNo, second.days[0].groupNo);
});

test('导入模板可生成，表头与说明页正确', async () => {
  const buffer = Buffer.from(await buildTemplateBuffer());
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(buffer.byteLength > 3000);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ['值班表', '填写说明'],
  );

  const sheet = workbook.getWorksheet('值班表');
  const headers = sheet.getRow(2).values.slice(1);
  assert.deepEqual(headers, ['序号', '日期', '带班领导', '值班领导', '工作人员']);
});
