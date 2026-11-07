import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const DATA_DIR = path.join(currentDir, 'data');
export const GROUPS_FILE = path.join(DATA_DIR, 'groups.json');
export const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
export const HOLIDAY_DIR = path.join(DATA_DIR, 'holidays');
export const SWAPS_FILE = path.join(DATA_DIR, 'swaps.json');
export const ASSIGNMENTS_FILE = path.join(DATA_DIR, 'assignments.json');

export const PORT = Number(process.env.PORT ?? 3100);
export const HOST = process.env.HOST ?? '0.0.0.0';

/** 管理员密码，可通过环境变量覆盖 */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Bgx@admin123';

/** 单次查询允许的最大天数，防止历史起始日期回溯过长 */
export const MAX_RANGE_DAYS = 366;
/** 从起排日期到查询结束日期之间允许回溯的最大天数 */
export const MAX_ANCHOR_SPAN_DAYS = 1500;
/** 上传 Excel 的大小上限（字节） */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
