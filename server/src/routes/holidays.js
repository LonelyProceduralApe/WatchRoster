import { Router } from 'express';
import { HolidayCalendar } from '../lib/holidays.js';
import { HttpError, assertDateKey, assertYear } from '../lib/http.js';

const router = Router();

function validateYearPayload(year, body = {}) {
  const holidays = [];
  for (const item of body.holidays ?? []) {
    const start = assertDateKey(item.start, 'holidays[].start');
    const end = assertDateKey(item.end ?? item.start, 'holidays[].end');
    if (start > end) {
      throw new HttpError(400, '节假日开始日期不能晚于结束日期', { start, end });
    }
    if (Number(start.slice(0, 4)) !== year || Number(end.slice(0, 4)) !== year) {
      throw new HttpError(400, `${year} 年的节假日配置不能跨年`, { start, end });
    }
    holidays.push({ name: item.name ?? '节假日', start, end });
  }

  const makeupWorkdays = (body.makeupWorkdays ?? []).map((key) => {
    const dateKey = assertDateKey(key, 'makeupWorkdays[]');
    if (Number(dateKey.slice(0, 4)) !== year) {
      throw new HttpError(400, `${year} 年的调休补班不能跨年`, { dateKey });
    }
    return dateKey;
  });

  return {
    verified: body.verified ?? true,
    source: body.source ?? '',
    holidays,
    makeupWorkdays,
  };
}

/** GET /api/holidays 列出已配置年份 */
router.get('/', (req, res) => {
  const calendar = HolidayCalendar.load();
  res.json({
    years: calendar.listYears().map((year) => calendar.describeYear(year)),
  });
});

/** GET /api/holidays/:year */
router.get('/:year', (req, res) => {
  const year = assertYear(req.params.year);
  const calendar = HolidayCalendar.load();
  res.json(calendar.describeYear(year));
});

/** PUT /api/holidays/:year 覆盖某年节假日配置 */
router.put('/:year', (req, res) => {
  const year = assertYear(req.params.year);
  const payload = validateYearPayload(year, req.body ?? {});
  HolidayCalendar.writeYear(year, payload);
  const calendar = HolidayCalendar.load();
  res.json(calendar.describeYear(year));
});

export default router;
