import fs from 'node:fs';
import path from 'node:path';
import { ASSIGNMENTS_FILE } from '../config.js';
import { isValidDateKey } from './date.js';
import { HttpError } from './http.js';

function emptyDoc() {
  return { assignments: [] };
}

export function readDoc() {
  if (!fs.existsSync(ASSIGNMENTS_FILE)) return emptyDoc();
  try {
    const doc = JSON.parse(fs.readFileSync(ASSIGNMENTS_FILE, 'utf8'));
    return { assignments: Array.isArray(doc.assignments) ? doc.assignments : [] };
  } catch {
    return emptyDoc();
  }
}

function writeDoc(doc) {
  fs.mkdirSync(path.dirname(ASSIGNMENTS_FILE), { recursive: true });
  fs.writeFileSync(ASSIGNMENTS_FILE, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

export function normalizeAssignment(raw = {}) {
  const date = String(raw.date ?? '');
  if (!isValidDateKey(date)) {
    throw new HttpError(400, 'date 必须为 YYYY-MM-DD', { date });
  }
  const staff = (Array.isArray(raw.staff) ? raw.staff : [])
    .map((name) => String(name ?? '').trim())
    .filter(Boolean);

  return {
    date,
    backupLeader: String(raw.backupLeader ?? '').trim(),
    dutyLeader: String(raw.dutyLeader ?? '').trim(),
    staff,
    updatedAt: new Date().toISOString(),
  };
}

export function listAssignments() {
  return readDoc().assignments.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function getAssignmentMap() {
  const map = new Map();
  for (const item of readDoc().assignments) map.set(item.date, item);
  return map;
}

export function upsertAssignment(raw) {
  const assignment = normalizeAssignment(raw);
  const doc = readDoc();
  const index = doc.assignments.findIndex((item) => item.date === assignment.date);
  if (index >= 0) doc.assignments[index] = assignment;
  else doc.assignments.push(assignment);
  writeDoc(doc);
  return assignment;
}

export function deleteAssignment(date) {
  if (!isValidDateKey(date)) {
    throw new HttpError(400, 'date 必须为 YYYY-MM-DD', { date });
  }
  const doc = readDoc();
  const before = doc.assignments.length;
  doc.assignments = doc.assignments.filter((item) => item.date !== date);
  writeDoc(doc);
  return { removed: before - doc.assignments.length };
}

/** 导入时整批合并：同日期覆盖，其余保留 */
export function mergeAssignments(list) {
  const doc = readDoc();
  const map = new Map(doc.assignments.map((item) => [item.date, item]));
  let created = 0;
  let updated = 0;
  for (const raw of list) {
    const assignment = normalizeAssignment(raw);
    if (map.has(assignment.date)) updated += 1;
    else created += 1;
    map.set(assignment.date, assignment);
  }
  doc.assignments = [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  writeDoc(doc);
  return { created, updated, total: doc.assignments.length };
}
