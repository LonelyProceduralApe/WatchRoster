const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function pad2(value) {
  return value < 10 ? '0' + value : '' + value;
}

function toKey(date) {
  return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
}

function parseKey(key) {
  const parts = String(key).split('-').map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function addDays(key, amount) {
  const date = parseKey(key);
  date.setDate(date.getDate() + amount);
  return toKey(date);
}

function weekdayLabel(key) {
  return WEEKDAY_LABELS[parseKey(key).getDay()];
}

function todayKey() {
  return toKey(new Date());
}

/** 以周一为一周起点 */
function weekRange(key) {
  const offset = (parseKey(key).getDay() + 6) % 7;
  const startDate = addDays(key, -offset);
  return { startDate, endDate: addDays(startDate, 6) };
}

function monthRange(key) {
  const date = parseKey(key);
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return {
    year,
    month,
    startDate: year + '-' + pad2(month) + '-01',
    endDate: toKey(new Date(year, month, 0)),
  };
}

function monthDay(key) {
  const parts = String(key).split('-').map(Number);
  return parts[1] + '月' + parts[2] + '日';
}

function monthDayShort(key) {
  const parts = String(key).split('-').map(Number);
  return pad2(parts[1]) + '-' + pad2(parts[2]);
}

module.exports = {
  pad2,
  toKey,
  parseKey,
  addDays,
  weekdayLabel,
  todayKey,
  weekRange,
  monthRange,
  monthDay,
  monthDayShort,
};
