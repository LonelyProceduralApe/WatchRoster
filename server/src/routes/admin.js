import { Router } from 'express';
import { extractToken, login, logout, requireAdmin, verifyToken } from '../lib/auth.js';
import {
  deleteAssignment,
  listAssignments,
  mergeAssignments,
  upsertAssignment,
} from '../lib/assignments.js';
import { deleteRequest, handleRequest, listRequests, summary } from '../lib/swaps.js';
import { parseRosterWorkbook } from '../lib/importWorkbook.js';
import { HttpError, asyncHandler, assertDateKey } from '../lib/http.js';
import { normalizeGroups, parseGroupList, parseGroupNo } from '../lib/groups.js';
import { readGroupsDoc, readSchedule, writeGroupsDoc, writeSchedule } from '../lib/store.js';
import { MAX_IMPORT_BYTES } from '../config.js';

const router = Router();

/** POST /api/admin/login —— 管理员密码验证 */
router.post('/login', (req, res) => {
  const session = login(req.body?.password);
  if (!session) throw new HttpError(401, '密码不正确');
  res.json(session);
});

/** POST /api/admin/logout */
router.post('/logout', (req, res) => {
  logout(extractToken(req));
  res.json({ ok: true });
});

/** GET /api/admin/session —— 校验当前 token */
router.get('/session', (req, res) => {
  res.json({ admin: verifyToken(extractToken(req)) });
});

/** GET /api/admin/swaps —— 全部换班申请 */
router.get('/swaps', requireAdmin, (req, res) => {
  res.json({
    requests: listRequests({ status: req.query.status }),
    summary: summary(),
  });
});

/** POST /api/admin/swaps/:id/approve|reject */
router.post('/swaps/:id/:action', requireAdmin, (req, res) => {
  const action = req.params.action === 'approve' ? 'approve' : 'reject';
  res.json({ request: handleRequest(req.params.id, action, '管理员') });
});

/** DELETE /api/admin/swaps/:id —— 删除某条换班申请（已批准的删除后换班失效） */
router.delete('/swaps/:id', requireAdmin, (req, res) => {
  res.json({ request: deleteRequest(req.params.id) });
});

/** GET /api/admin/settings —— 排班参数、分组人员与请假配置 */
router.get('/settings', requireAdmin, (req, res) => {
  const schedule = readSchedule();
  res.json({
    schedule,
    groups: readGroupsDoc(),
    substitution: schedule.substitution ?? null,
    shifts: schedule.shifts ?? null,
  });
});

const ANCHOR_FIELDS = ['workdayAnchorDate', 'weekendAnchorDate', 'holidayAnchorDate'];
const DAY_TYPES = ['workday', 'weekend', 'holiday'];

/** PUT /api/admin/schedule —— 分别设置三条序列的起排日期与起始组号 */
router.put('/schedule', requireAdmin, (req, res) => {
  const body = req.body ?? {};
  const current = readSchedule();
  const next = { ...current };

  for (const field of ANCHOR_FIELDS) {
    if (field in body) {
      next[field] = body[field] === null ? null : assertDateKey(body[field], field);
    }
  }

  // 兼容旧的统一起排日期
  if ('anchorDate' in body && !ANCHOR_FIELDS.some((field) => field in body)) {
    const value = body.anchorDate === null ? null : assertDateKey(body.anchorDate, 'anchorDate');
    for (const field of ANCHOR_FIELDS) next[field] = value;
  }
  delete next.anchorDate;

  for (const field of ['workdayStartGroup', 'weekendStartGroup', 'holidayStartGroup']) {
    if (field in body) next[field] = parseGroupNo(body[field], field);
  }

  // 请假领导代班：三条序列各自的轮转起始日与起始组
  if (
    'substitutionRotationStarts' in body ||
    'substitutionStartGroups' in body ||
    'substitutionRotationStart' in body ||
    'substitutionStartGroup' in body
  ) {
    const substitution = { ...(current.substitution ?? {}) };
    const leaveGroups = Array.isArray(substitution.leaveGroups) ? substitution.leaveGroups : [];
    // 队列与请假名单保持一致，避免代班时跳过某些组
    substitution.queue = Array.from({ length: 10 }, (_, index) => index + 1).filter(
      (no) => !leaveGroups.includes(no),
    );

    if ('substitutionRotationStarts' in body) {
      const raw = body.substitutionRotationStarts ?? {};
      substitution.rotationStarts = {};
      for (const dayType of DAY_TYPES) {
        const value = raw[dayType];
        substitution.rotationStarts[dayType] =
          value === null || value === undefined || value === ''
            ? null
            : assertDateKey(value, `substitutionRotationStarts.${dayType}`);
      }
    }

    if ('substitutionStartGroups' in body) {
      const raw = body.substitutionStartGroups ?? {};
      substitution.startGroups = { ...(substitution.startGroups ?? {}) };
      for (const dayType of DAY_TYPES) {
        if (raw[dayType] === undefined) continue;
        const picked = parseGroupNo(raw[dayType], `substitutionStartGroups.${dayType}`);
        if (leaveGroups.includes(picked)) {
          throw new HttpError(400, '起始组不能是正在请假的组', { dayType, startGroup: picked });
        }
        substitution.startGroups[dayType] = picked;
      }
    }

    // 兼容旧的单值配置：同时作用于三条序列
    if ('substitutionRotationStart' in body) {
      substitution.rotationStart =
        body.substitutionRotationStart === null || body.substitutionRotationStart === ''
          ? null
          : assertDateKey(body.substitutionRotationStart, 'substitutionRotationStart');
    }
    if ('substitutionStartGroup' in body) {
      const picked = parseGroupNo(body.substitutionStartGroup, 'substitutionStartGroup');
      if (leaveGroups.includes(picked)) {
        throw new HttpError(400, '起始组不能是正在请假的组', { startGroup: picked });
      }
      substitution.startGroup = picked;
    }

    next.substitution = substitution;
  }

  writeSchedule(next);
  res.json({ schedule: next });
});

/** PUT /api/admin/groups —— 整体保存 10 个组的人员（可增删成员、改名字） */
router.put('/groups', requireAdmin, (req, res) => {
  const groups = normalizeGroups(req.body?.groups);
  const doc = { ...readGroupsDoc(), groups };
  writeGroupsDoc(doc);
  res.json({ groups: doc });
});

/** PUT /api/admin/leave —— 设置哪些组的带班领导请假（由队列代班） */
router.put('/leave', requireAdmin, (req, res) => {
  const current = readSchedule();
  const substitution = { ...(current.substitution ?? {}) };

  if (req.body?.leaveGroups !== undefined) {
    substitution.leaveGroups = parseGroupList(req.body.leaveGroups, 'leaveGroups');
  }
  const leaveGroups = Array.isArray(substitution.leaveGroups) ? substitution.leaveGroups : [];
  // 代班队列始终与请假名单同步：1-10 中未请假的组，避免出现「跳过某组」
  substitution.queue = Array.from({ length: 10 }, (_, index) => index + 1).filter(
    (no) => !leaveGroups.includes(no),
  );
  if (typeof req.body?.enabled === 'boolean') {
    substitution.enabled = req.body.enabled;
  }
  if (req.body?.startGroup !== undefined) {
    substitution.startGroup = parseGroupNo(req.body.startGroup, 'startGroup');
  }
  if (substitution.queue.length === 0) {
    throw new HttpError(400, '所有组都请假了，没有可代班的组');
  }
  if (!substitution.queue.includes(Number(substitution.startGroup))) {
    substitution.startGroup = substitution.queue[0];
  }

  writeSchedule({ ...current, substitution });
  res.json({ substitution });
});

/** GET /api/admin/assignments —— 手工设置的值班人员 */
router.get('/assignments', requireAdmin, (req, res) => {
  res.json({ assignments: listAssignments() });
});

/** PUT /api/admin/assignments —— 设置某天值班人员 */
router.put('/assignments', requireAdmin, (req, res) => {
  res.json({ assignment: upsertAssignment(req.body ?? {}) });
});

/** DELETE /api/admin/assignments/:date —— 恢复自动排班 */
router.delete('/assignments/:date', requireAdmin, (req, res) => {
  res.json(deleteAssignment(req.params.date));
});

/** POST /api/admin/import —— 导入 Excel 值班表（base64） */
router.post(
  '/import',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { fileName = '', contentBase64 = '' } = req.body ?? {};
    if (!contentBase64) throw new HttpError(400, '缺少文件内容');

    const raw = String(contentBase64).replace(/^data:[^,]+,/, '');
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.byteLength === 0) throw new HttpError(400, '文件内容为空');
    if (buffer.byteLength > MAX_IMPORT_BYTES) {
      throw new HttpError(413, `文件不能超过 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB`);
    }

    const parsed = await parseRosterWorkbook(buffer);
    const merged = mergeAssignments(parsed.assignments);

    res.json({
      fileName,
      sheetName: parsed.sheetName,
      imported: parsed.assignments.length,
      created: merged.created,
      updated: merged.updated,
      total: merged.total,
      warnings: parsed.warnings,
      dates: parsed.assignments.map((item) => item.date),
    });
  }),
);

export default router;
