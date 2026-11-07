import ExcelJS from 'exceljs';
import { isValidDateKey } from './date.js';
import { HttpError } from './http.js';

const HEADER_ALIASES = {
  date: ['日期', '值班日期', 'date'],
  backupLeader: ['带班领导', '带班'],
  dutyLeader: ['值班领导', '值班'],
  staff: ['工作人员', '值班人员', '人员', '成员'],
};

function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}

function valueText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((item) => item.text).join('');
    if (value.text !== undefined) return String(value.text).trim();
    if (value.result !== undefined) return valueText(value.result);
    return '';
  }
  return String(value).trim();
}

function toDateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
  }
  const text = String(value ?? '')
    .trim()
    .replace(/[年月/.]/g, '-')
    .replace(/日/g, '')
    .replace(/\s+/g, '');
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const key = `${match[1]}-${pad2(Number(match[2]))}-${pad2(Number(match[3]))}`;
  return isValidDateKey(key) ? key : null;
}

function splitNames(value) {
  return String(value ?? '')
    .split(/[、,，;；/\s]+/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function detectHeader(rows) {
  for (let index = 0; index < Math.min(rows.length, 10); index += 1) {
    const row = rows[index].map((cell) => String(valueText(cell)).trim());
    if (!row.includes('日期') && !row.includes('值班日期')) continue;
    const findColumn = (aliases) =>
      row.findIndex((text) => aliases.includes(text));
    const columns = {
      date: findColumn(HEADER_ALIASES.date),
      backupLeader: findColumn(HEADER_ALIASES.backupLeader),
      dutyLeader: findColumn(HEADER_ALIASES.dutyLeader),
      staff: findColumn(HEADER_ALIASES.staff),
    };
    if (columns.date >= 0) return { headerIndex: index, columns };
  }
  return null;
}

/**
 * 解析值班表 Excel（列：日期 / 带班领导 / 值班领导 / 工作人员）
 */
export async function parseRosterWorkbook(buffer) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new HttpError(400, '无法解析该文件，请上传 .xlsx 格式的值班表');
  }

  const sheet =
    workbook.worksheets.find((item) => item.name.includes('值班')) ?? workbook.worksheets[0];
  if (!sheet) throw new HttpError(400, 'Excel 中没有可用的工作表');

  const rows = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells = [];
    for (let column = 1; column <= row.cellCount; column += 1) {
      cells.push(valueText(row.getCell(column).value));
    }
    rows.push(cells);
  });

  const header = detectHeader(rows);
  if (!header) {
    throw new HttpError(400, '未找到表头，请确保表格包含“日期”“带班领导”“值班领导”“工作人员”列');
  }

  const { headerIndex, columns } = header;
  const assignments = [];
  const warnings = [];
  const seen = new Set();

  for (let index = headerIndex + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const dateKey = toDateKey(row[columns.date]);
    const backupLeader = columns.backupLeader >= 0 ? String(valueText(row[columns.backupLeader])).trim() : '';
    const dutyLeader = columns.dutyLeader >= 0 ? String(valueText(row[columns.dutyLeader])).trim() : '';
    const staff =
      columns.staff >= 0 ? splitNames(valueText(row[columns.staff])) : [];

    if (!dateKey) {
      if (backupLeader || dutyLeader || staff.length > 0) {
        warnings.push(`第 ${index + 1} 行日期无法识别，已跳过`);
      }
      continue;
    }
    if (!backupLeader && !dutyLeader && staff.length === 0) continue;
    if (seen.has(dateKey)) {
      warnings.push(`${dateKey} 重复出现，以最后一行为准`);
    }
    seen.add(dateKey);

    assignments.push({ date: dateKey, backupLeader, dutyLeader, staff });
  }

  if (assignments.length === 0) {
    throw new HttpError(400, '表格中没有可导入的值班数据');
  }

  return { sheetName: sheet.name, assignments, warnings };
}
