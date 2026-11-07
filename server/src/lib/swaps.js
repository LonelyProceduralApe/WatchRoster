import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SWAPS_FILE } from '../config.js';
import { isValidDateKey } from './date.js';
import { HttpError } from './http.js';

export const ROLES = ['backupLeader', 'dutyLeader', 'staff'];
export const ROLE_LABELS = {
  backupLeader: '带班领导',
  dutyLeader: '值班领导',
  staff: '工作人员',
};

function emptyDoc() {
  return { requests: [] };
}

export function readDoc() {
  if (!fs.existsSync(SWAPS_FILE)) return emptyDoc();
  try {
    const doc = JSON.parse(fs.readFileSync(SWAPS_FILE, 'utf8'));
    return { requests: Array.isArray(doc.requests) ? doc.requests : [] };
  } catch {
    return emptyDoc();
  }
}

function writeDoc(doc) {
  fs.mkdirSync(path.dirname(SWAPS_FILE), { recursive: true });
  fs.writeFileSync(SWAPS_FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

function normalizeSide(side, field) {
  if (!side || typeof side !== 'object') {
    throw new HttpError(400, `${field} 不能为空`);
  }
  const name = String(side.name ?? '').trim();
  if (!name) throw new HttpError(400, `${field}.name 不能为空`);
  const date = String(side.date ?? '');
  if (!isValidDateKey(date)) {
    throw new HttpError(400, `${field}.date 必须为 YYYY-MM-DD`, { field, date });
  }
  const role = ROLES.includes(side.role) ? side.role : 'backupLeader';
  const groupNo = Number(side.groupNo);
  return {
    name,
    date,
    role,
    roleLabel: ROLE_LABELS[role],
    groupNo: Number.isInteger(groupNo) ? groupNo : null,
  };
}

export function createRequest(payload = {}) {
  const requester = normalizeSide(payload.requester, 'requester');
  const target = normalizeSide(payload.target, 'target');

  if (requester.name === target.name) throw new HttpError(400, '不能和自己换班');
  if (requester.date === target.date) throw new HttpError(400, '两个换班日期不能相同');

  const doc = readDoc();
  const duplicated = doc.requests.some(
    (item) =>
      item.status === 'pending' &&
      item.requester.name === requester.name &&
      item.requester.date === requester.date,
  );
  if (duplicated) {
    throw new HttpError(409, `${requester.date} 的换班申请已提交，请等待处理`, { date: requester.date });
  }

  const request = {
    id: `SW${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
    createdAt: new Date().toISOString(),
    status: 'pending',
    requester,
    target,
    reason: String(payload.reason ?? '').slice(0, 200),
    handledAt: null,
    handledBy: null,
  };
  doc.requests.unshift(request);
  writeDoc(doc);
  return request;
}

export function listRequests({ name, status, limit = 200 } = {}) {
  let list = readDoc().requests;
  if (status) list = list.filter((item) => item.status === status);
  if (name) {
    list = list.filter(
      (item) => item.requester.name === name || item.target.name === name,
    );
  }
  return list.slice(0, Number(limit) || 200);
}

export function findRequest(id) {
  return readDoc().requests.find((item) => item.id === id) ?? null;
}

const ACTION_STATUS = { approve: 'approved', reject: 'rejected', cancel: 'cancelled' };

export function handleRequest(id, action, actor = '管理员') {
  const status = ACTION_STATUS[action];
  if (!status) throw new HttpError(400, '不支持的操作', { action });

  const doc = readDoc();
  const request = doc.requests.find((item) => item.id === id);
  if (!request) throw new HttpError(404, '换班申请不存在', { id });
  if (request.status !== 'pending') {
    throw new HttpError(409, '该申请已处理', { status: request.status });
  }

  request.status = status;
  request.handledAt = new Date().toISOString();
  request.handledBy = actor;
  writeDoc(doc);
  return request;
}

/** 管理员删除某条申请；已批准的申请被删除后，对应换班也随之失效 */
export function deleteRequest(id) {
  const doc = readDoc();
  const index = doc.requests.findIndex((item) => item.id === id);
  if (index < 0) throw new HttpError(404, '换班申请不存在', { id });
  const [removed] = doc.requests.splice(index, 1);
  writeDoc(doc);
  return removed;
}

/** 已批准的换班，用于覆盖排班表 */
export function approvedSwaps() {
  return readDoc()
    .requests.filter((item) => item.status === 'approved')
    .map((item) => ({ id: item.id, requester: item.requester, target: item.target }));
}

export function summary(name) {
  const requests = readDoc().requests;
  const pending = requests.filter((item) => item.status === 'pending');
  const key = name ? String(name).trim() : '';
  return {
    name: key || null,
    pendingTotal: pending.length,
    pendingAsTarget: key ? pending.filter((item) => item.target.name === key).length : 0,
    pendingAsRequester: key ? pending.filter((item) => item.requester.name === key).length : 0,
    approvedTotal: requests.filter((item) => item.status === 'approved').length,
  };
}
