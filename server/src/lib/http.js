export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function assertDateKey(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `参数 ${field} 格式必须为 YYYY-MM-DD`, { field, value });
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new HttpError(400, `参数 ${field} 不是合法日期`, { field, value });
  }
  return value;
}

export function assertGroupNo(value, field, fallback = 1) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 10) {
    throw new HttpError(400, `参数 ${field} 必须是 1-10 的整数`, { field, value });
  }
  return number;
}

export function assertYear(value, field = 'year') {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1970 || number > 2100) {
    throw new HttpError(400, `参数 ${field} 必须是 1970-2100 之间的整数`, { field, value });
  }
  return number;
}
