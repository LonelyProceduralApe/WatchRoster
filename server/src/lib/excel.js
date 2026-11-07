import ExcelJS from 'exceljs';
import { DAY_TYPE_LABELS } from './calendar.js';
import { formatCnDate } from './date.js';

const COLUMNS = [
  { key: 'index', width: 7 },
  { key: 'date', width: 13 },
  { key: 'weekday', width: 8 },
  { key: 'dayTypeLabel', width: 18 },
  { key: 'shiftName', width: 10 },
  { key: 'shiftTime', width: 20 },
  { key: 'groupName', width: 11 },
  { key: 'backupLeader', width: 14 },
  { key: 'dutyLeader', width: 14 },
  { key: 'staffText', width: 26 },
  { key: 'note', width: 42 },
];

const HEADERS = [
  '序号',
  '日期',
  '星期',
  '日期类型',
  '班次',
  '值班时间安排',
  '值班组',
  '带班领导',
  '值班领导',
  '工作人员',
  '备注',
];

const COLUMN_COUNT = COLUMNS.length;

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
const SUBSTITUTE_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
};

function styleHeaderRow(row) {
  row.height = 22;
  for (let column = 1; column <= COLUMN_COUNT; column += 1) {
    const cell = row.getCell(column);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = THIN_BORDER;
  }
}

function styleDataRow(row) {
  for (let column = 1; column <= COLUMN_COUNT; column += 1) {
    const cell = row.getCell(column);
    cell.border = THIN_BORDER;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  }
}

function toRowValues(day, index) {
  return [
    index + 1,
    day.date,
    day.weekday,
    day.dayTypeLabel,
    day.shiftName,
    day.shiftTime,
    day.groupName,
    day.backupLeader || '（未配置）',
    day.dutyLeader || '（未配置）',
    day.staffText || '（未配置）',
    day.note,
  ];
}

function buildRosterSheet(workbook, roster) {
  const sheet = workbook.addWorksheet('值班表', {
    views: [{ state: 'frozen', ySplit: 2 }],
  });
  COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
  });

  sheet.mergeCells(1, 1, 1, COLUMN_COUNT);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `值班表（${formatCnDate(roster.meta.startDate)} 至 ${formatCnDate(
    roster.meta.endDate,
  )}）`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 28;

  const headerRow = sheet.getRow(2);
  HEADERS.forEach((header, index) => {
    headerRow.getCell(index + 1).value = header;
  });
  styleHeaderRow(headerRow);

  roster.days.forEach((day, index) => {
    const row = sheet.addRow(toRowValues(day, index));
    styleDataRow(row);
    row.getCell(10).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    row.getCell(11).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    if (day.substituted) {
      for (let column = 1; column <= COLUMN_COUNT; column += 1) {
        row.getCell(column).fill = SUBSTITUTE_FILL;
      }
    }
  });

  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: 2 + roster.days.length, column: COLUMN_COUNT },
  };
  return sheet;
}

function buildStatsSheet(workbook, roster) {
  const sheet = workbook.addWorksheet('统计');
  const widths = [10, 14, 12, 12, 12, 10, 12];
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  sheet.mergeCells(1, 1, 1, 7);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = '各组值班天数统计';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 26;

  const headerRow = sheet.getRow(2);
  [
    '组号',
    '组名',
    DAY_TYPE_LABELS.workday,
    DAY_TYPE_LABELS.weekend,
    DAY_TYPE_LABELS.holiday,
    '合计',
    '代班次数',
  ].forEach((header, index) => {
    headerRow.getCell(index + 1).value = header;
  });
  styleHeaderRow(headerRow);

  for (const stat of roster.stats.groups) {
    const row = sheet.addRow([
      stat.groupNo,
      stat.groupName,
      stat.workday,
      stat.weekend,
      stat.holiday,
      stat.total,
      stat.backupDutyDays,
    ]);
    for (let column = 1; column <= 7; column += 1) {
      const cell = row.getCell(column);
      cell.border = THIN_BORDER;
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
    }
  }

  const notes = [
    `排班区间：${roster.meta.startDate} ~ ${roster.meta.endDate}`,
    `起排日期：工作日 ${roster.meta.anchors.workday} / 周末 ${roster.meta.anchors.weekend} / 节假日 ${roster.meta.anchors.holiday}`,
    `工作日 ${roster.meta.dayTypeCount.workday} 天 / 周末 ${roster.meta.dayTypeCount.weekend} 天 / 节假日 ${roster.meta.dayTypeCount.holiday} 天`,
    `代班合计：${roster.meta.substitutionCount} 次`,
  ];
  sheet.addRow([]);
  for (const text of notes) {
    const row = sheet.addRow([text]);
    sheet.mergeCells(row.number, 1, row.number, 7);
    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
  }

  if (roster.substitutions.length > 0) {
    sheet.addRow([]);
    const subHeader = sheet.addRow(['日期', '原值班组', '代班组', '说明']);
    sheet.mergeCells(subHeader.number, 4, subHeader.number, 7);
    styleHeaderRow(subHeader);
    for (const item of roster.substitutions) {
      const row = sheet.addRow([item.date, item.fromGroupNo, item.byGroupNo, item.note]);
      sheet.mergeCells(row.number, 4, row.number, 7);
      for (let column = 1; column <= 7; column += 1) {
        const cell = row.getCell(column);
        cell.border = THIN_BORDER;
        cell.fill = SUBSTITUTE_FILL;
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      }
      row.getCell(4).alignment = { vertical: 'middle', horizontal: 'left' };
    }
  }

  if (roster.meta.warnings.length > 0) {
    sheet.addRow([]);
    for (const warning of roster.meta.warnings) {
      const row = sheet.addRow([`提示：${warning}`]);
      sheet.mergeCells(row.number, 1, row.number, 7);
      row.getCell(1).font = { color: { argb: 'FFC00000' } };
      row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    }
  }
  return sheet;
}

export async function buildWorkbook(roster) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WatchRoster';
  workbook.created = new Date();
  buildRosterSheet(workbook, roster);
  buildStatsSheet(workbook, roster);
  return workbook;
}

export async function buildWorkbookBuffer(roster) {
  const workbook = await buildWorkbook(roster);
  return workbook.xlsx.writeBuffer();
}

const TEMPLATE_HEADERS = ['序号', '日期', '带班领导', '值班领导', '工作人员'];
const TEMPLATE_WIDTHS = [8, 16, 16, 16, 32];

/** 导入用的空白模板 */
export async function buildTemplateBuffer() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WatchRoster';

  const sheet = workbook.addWorksheet('值班表');
  TEMPLATE_WIDTHS.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });

  const columnCount = TEMPLATE_HEADERS.length;
  sheet.mergeCells(1, 1, 1, columnCount);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = '值班表（填写后导入）';
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.getRow(1).height = 28;

  const headerRow = sheet.getRow(2);
  headerRow.height = 22;
  TEMPLATE_HEADERS.forEach((header, index) => {
    headerRow.getCell(index + 1).value = header;
  });
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = headerRow.getCell(column);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = THIN_BORDER;
  }

  for (let rowIndex = 3; rowIndex <= 42; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    for (let column = 1; column <= columnCount; column += 1) {
      const cell = row.getCell(column);
      cell.border = THIN_BORDER;
      cell.alignment = {
        vertical: 'middle',
        horizontal: column === columnCount ? 'left' : 'center',
      };
    }
  }

  const guide = workbook.addWorksheet('填写说明');
  guide.getColumn(1).width = 80;
  const lines = [
    '填写说明',
    '1. 日期格式：2026-11-05（也支持 2026/11/5）。',
    '2. 工作人员多人用顿号分隔，例如：王五、赵六。',
    '3. 导入时按日期覆盖：同一日期已存在的设置会被本表内容替换。',
    '4. 只需填写有调整的日期，其余日期保持自动排班。',
    '5. 第一行标题不要改动，否则无法识别。',
  ];
  lines.forEach((text, index) => {
    const row = guide.addRow([text]);
    row.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
    if (index === 0) row.getCell(1).font = { bold: true, size: 14 };
  });

  return workbook.xlsx.writeBuffer();
}
