import { Router } from 'express';
import { HolidayCalendar } from '../lib/holidays.js';
import { buildCalendar } from '../lib/roster.js';
import { HttpError, assertYear } from '../lib/http.js';

const router = Router();

/** GET /api/calendar?year=2026&month=11 */
router.get('/', (req, res) => {
  const now = new Date();
  const year = assertYear(req.query.year ?? now.getFullYear());
  let month = null;
  if (req.query.month !== undefined && req.query.month !== '') {
    month = Number(req.query.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new HttpError(400, '参数 month 必须是 1-12 的整数', { value: req.query.month });
    }
  }
  const holidayCalendar = HolidayCalendar.load();
  const calendar = buildCalendar({ year, month, holidayCalendar });
  res.json({
    ...calendar,
    holidayData: holidayCalendar.describeYear(year),
  });
});

export default router;
