import { HttpError } from './http.js';

export const GROUP_COUNT = 10;

export function parseGroupNo(value, field) {
  const no = Number(value);
  if (!Number.isInteger(no) || no < 1 || no > GROUP_COUNT) {
    throw new HttpError(400, `参数 ${field} 必须是 1-${GROUP_COUNT} 的整数`, { field, value });
  }
  return no;
}

export function parseGroupList(value, field) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `参数 ${field} 必须是数组`, { field });
  }
  return [...new Set(value.map((item) => parseGroupNo(item, `${field}[]`)))];
}

function text(value, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

/** 校验并规范化 10 个组的人员配置：可增删工作人员、改名字 */
export function normalizeGroups(input) {
  if (!Array.isArray(input)) {
    throw new HttpError(400, '参数 groups 必须是数组');
  }

  const seen = new Set();
  const groups = input.map((raw, index) => {
    const no = parseGroupNo(raw && raw.no, `groups[${index}].no`);
    if (seen.has(no)) throw new HttpError(400, `组号 ${no} 重复`, { no });
    seen.add(no);

    const staff = (Array.isArray(raw.staff) ? raw.staff : [])
      .map((name) => text(name))
      .filter(Boolean);

    return {
      no,
      name: text(raw.name, `第${no}组`),
      backupLeader: text(raw.backupLeader),
      dutyLeader: text(raw.dutyLeader),
      staff: [...new Set(staff)],
    };
  });

  return groups.sort((a, b) => a.no - b.no);
}
