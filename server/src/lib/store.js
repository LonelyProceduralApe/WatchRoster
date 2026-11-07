import fs from 'node:fs';
import path from 'node:path';
import { GROUPS_FILE, SCHEDULE_FILE, DATA_DIR } from '../config.js';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = `${file}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tempFile, file);
  return data;
}

export function ensureDataDir() {
  fs.mkdirSync(path.join(DATA_DIR, 'holidays'), { recursive: true });
}

export function readSchedule() {
  return readJson(SCHEDULE_FILE);
}

export function writeSchedule(schedule) {
  return writeJson(SCHEDULE_FILE, schedule);
}

export function readGroupsDoc() {
  return readJson(GROUPS_FILE);
}

export function writeGroupsDoc(groupsDoc) {
  return writeJson(GROUPS_FILE, groupsDoc);
}

export function toGroupMap(groupsDoc) {
  const map = new Map();
  const groups = Array.isArray(groupsDoc) ? groupsDoc : groupsDoc?.groups ?? [];
  for (const group of groups) {
    const no = Number(group.no);
    if (Number.isInteger(no)) map.set(no, group);
  }
  return map;
}

/** 从配置读取组别；缺失的组用占位数据补齐，保证 10 个组始终可用 */
export function loadGroupMap(groupsDoc) {
  const map = toGroupMap(groupsDoc);
  const fallback = new Map();
  for (let no = 1; no <= 10; no += 1) {
    fallback.set(no, map.get(no) ?? createPlaceholderGroup(no));
  }
  return fallback;
}

export function createPlaceholderGroup(no) {
  return {
    no,
    name: `第${no}组`,
    backupLeader: '',
    dutyLeader: '',
    staff: [],
  };
}
