import fs from 'node:fs';
import path from 'node:path';
import { HOLIDAY_DIR } from '../config.js';
import { isValidDateKey, rangeKeys } from './date.js';

/** 未配置年份的兜底规则：只覆盖固定公历节日，不含调休，结果标记为“未校核” */
const FALLBACK_RULES = [
  { name: '元旦', start: '01-01', end: '01-01' },
  { name: '劳动节', start: '05-01', end: '05-02' },
  { name: '国庆节', start: '10-01', end: '10-03' },
];

function buildDayIndex(holidays, makeupWorkdays) {
  const days = new Map();
  for (const holiday of holidays) {
    for (const key of rangeKeys(holiday.start, holiday.end)) {
      days.set(key, { isHoliday: true, holidayName: holiday.name, isMakeupWorkday: false });
    }
  }
  for (const key of makeupWorkdays) {
    const existing = days.get(key);
    if (existing?.isHoliday) continue;
    days.set(key, { isHoliday: false, holidayName: null, isMakeupWorkday: true });
  }
  return days;
}

function normalizeYear(raw) {
  const holidays = (raw.holidays ?? [])
    .filter((item) => isValidDateKey(item.start) && isValidDateKey(item.end))
    .map((item) => ({ name: item.name ?? '节假日', start: item.start, end: item.end }));
  const makeupWorkdays = (raw.makeupWorkdays ?? []).filter(isValidDateKey);
  return {
    year: Number(raw.year),
    verified: Boolean(raw.verified),
    source: raw.source ?? '',
    updatedAt: raw.updatedAt ?? null,
    holidays,
    makeupWorkdays,
    days: buildDayIndex(holidays, makeupWorkdays),
  };
}

function buildFallbackYear(year) {
  const holidays = FALLBACK_RULES.map((rule) => ({
    name: rule.name,
    start: `${year}-${rule.start}`,
    end: `${year}-${rule.end}`,
  }));
  return {
    year,
    verified: false,
    source: '内置兜底规则（未获取到官方通知，含春节/端午/中秋的日期可能不准）',
    updatedAt: null,
    holidays,
    makeupWorkdays: [],
    days: buildDayIndex(holidays, []),
    fallback: true,
  };
}

export class HolidayCalendar {
  constructor(yearDatas = []) {
    this.years = new Map();
    this.fallbackYears = new Map();
    for (const raw of yearDatas) {
      const year = normalizeYear(raw);
      this.years.set(year.year, year);
    }
  }

  static load(dir = HOLIDAY_DIR) {
    if (!fs.existsSync(dir)) return new HolidayCalendar();
    const files = fs
      .readdirSync(dir)
      .filter((file) => /^\d{4}\.json$/.test(file))
      .sort();
    const datas = [];
    for (const file of files) {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      datas.push({ ...raw, year: raw.year ?? Number(file.slice(0, 4)) });
    }
    return new HolidayCalendar(datas);
  }

  static writeYear(year, payload, dir = HOLIDAY_DIR) {
    fs.mkdirSync(dir, { recursive: true });
    const data = {
      year: Number(year),
      verified: Boolean(payload.verified),
      source: payload.source ?? '',
      updatedAt: payload.updatedAt ?? new Date().toISOString().slice(0, 10),
      holidays: payload.holidays ?? [],
      makeupWorkdays: payload.makeupWorkdays ?? [],
    };
    fs.writeFileSync(
      path.join(dir, `${year}.json`),
      `${JSON.stringify(data, null, 2)}\n`,
      'utf8',
    );
    return data;
  }

  getYearData(year) {
    const key = Number(year);
    if (this.years.has(key)) return this.years.get(key);
    if (!this.fallbackYears.has(key)) this.fallbackYears.set(key, buildFallbackYear(key));
    return this.fallbackYears.get(key);
  }

  hasOfficialData(year) {
    return this.years.has(Number(year));
  }

  /** 某一天的节假日信息 */
  getDay(key) {
    const year = Number(key.slice(0, 4));
    const data = this.getYearData(year);
    const entry = data.days.get(key);
    return {
      isHoliday: Boolean(entry?.isHoliday),
      holidayName: entry?.holidayName ?? null,
      isMakeupWorkday: Boolean(entry?.isMakeupWorkday),
      verified: data.verified,
    };
  }

  /** 供接口返回的年度数据视图 */
  describeYear(year) {
    const data = this.getYearData(year);
    return {
      year: data.year,
      verified: data.verified,
      official: !data.fallback,
      source: data.source,
      updatedAt: data.updatedAt,
      holidays: data.holidays,
      makeupWorkdays: data.makeupWorkdays,
      holidayDays: data.holidays.reduce(
        (total, item) => total + rangeKeys(item.start, item.end).length,
        0,
      ),
    };
  }

  listYears() {
    return [...this.years.keys()].sort((a, b) => a - b);
  }
}
