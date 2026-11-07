import { Router } from 'express';
import { readGroupsDoc, readSchedule, writeGroupsDoc, writeSchedule } from '../lib/store.js';
import { HttpError, assertDateKey, assertGroupNo } from '../lib/http.js';
import { normalizeGroups } from '../lib/groups.js';

const router = Router();

function parseGroupNoValue(value, field) {
  const no = Number(value);
  if (!Number.isInteger(no) || no < 1 || no > 10) {
    throw new HttpError(400, `参数 ${field} 必须是 1-10 的整数`, { field, value });
  }
  return no;
}

function parseGroupList(value, field) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `参数 ${field} 必须是数组`, { field });
  }
  return value.map((item) => parseGroupNoValue(item, `${field}[]`));
}

/** GET /api/config 返回排班参数与组别人员 */
router.get('/', (req, res) => {
  res.json({ schedule: readSchedule(), groups: readGroupsDoc() });
});

/** PUT /api/config/schedule 更新排班参数 */
router.put('/schedule', (req, res) => {
  const body = req.body ?? {};
  const current = readSchedule();
  const next = { ...current };

  if ('anchorDate' in body) {
    next.anchorDate = body.anchorDate === null ? null : assertDateKey(body.anchorDate, 'anchorDate');
  }
  for (const field of ['workdayStartGroup', 'weekendStartGroup', 'holidayStartGroup']) {
    if (field in body) next[field] = assertGroupNo(body[field], field);
  }

  if (body.substitution && typeof body.substitution === 'object') {
    const merged = { ...(current.substitution ?? {}), ...body.substitution };
    const leaveGroups =
      merged.leaveGroups === undefined
        ? (current.substitution?.leaveGroups ?? [3, 4])
        : parseGroupList(merged.leaveGroups, 'substitution.leaveGroups');
    const substitution = {
      enabled: merged.enabled !== false,
      leaveGroups,
      // 队列与请假名单保持同步：1-10 中未请假的组
      queue: Array.from({ length: 10 }, (_, index) => index + 1).filter(
        (no) => !leaveGroups.includes(no),
      ),
      startGroup:
        merged.startGroup === undefined
          ? (current.substitution?.startGroup ?? 1)
          : assertGroupNo(merged.startGroup, 'substitution.startGroup'),
      rotationStart:
        merged.rotationStart === undefined
          ? (current.substitution?.rotationStart ?? null)
          : merged.rotationStart === null
            ? null
            : assertDateKey(merged.rotationStart, 'substitution.rotationStart'),
      startDate:
        merged.startDate === null || merged.startDate === undefined
          ? null
          : assertDateKey(merged.startDate, 'substitution.startDate'),
      endDate:
        merged.endDate === null || merged.endDate === undefined
          ? null
          : assertDateKey(merged.endDate, 'substitution.endDate'),
      reason: merged.reason ?? current.substitution?.reason ?? '请长假',
    };

    // 三条序列各自的代班起始组与轮转起始日
    const startGroupsRaw = merged.startGroups ?? {};
    const rotationStartsRaw = merged.rotationStarts ?? {};
    substitution.startGroups = {};
    substitution.rotationStarts = {};
    for (const dayType of ['workday', 'weekend', 'holiday']) {
      if (startGroupsRaw[dayType] !== undefined) {
        substitution.startGroups[dayType] = assertGroupNo(
          startGroupsRaw[dayType],
          `substitution.startGroups.${dayType}`,
        );
      }
      const rotation = rotationStartsRaw[dayType];
      substitution.rotationStarts[dayType] =
        rotation === null || rotation === undefined || rotation === ''
          ? null
          : assertDateKey(rotation, `substitution.rotationStarts.${dayType}`);
    }

    if (!substitution.queue.includes(Number(substitution.startGroup))) {
      substitution.startGroup = substitution.queue[0] ?? 1;
    }
    if (substitution.startDate && substitution.endDate && substitution.startDate > substitution.endDate) {
      throw new HttpError(400, '代班开始日期不能晚于结束日期');
    }
    next.substitution = substitution;
  }

  writeSchedule(next);
  res.json({ schedule: next });
});

/** PUT /api/config/groups 批量更新组别与人员 */
router.put('/groups', (req, res) => {
  const groups = normalizeGroups(req.body?.groups);
  const next = { ...readGroupsDoc(), groups };
  writeGroupsDoc(next);
  res.json({ groups: next });
});

export default router;
