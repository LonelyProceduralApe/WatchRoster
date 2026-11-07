import crypto from 'node:crypto';
import { ADMIN_PASSWORD } from '../config.js';

const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const tokens = new Map();

export function login(password) {
  if (typeof password !== 'string' || password !== ADMIN_PASSWORD) return null;
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  tokens.set(token, expiresAt);
  return { token, expiresAt: new Date(expiresAt).toISOString() };
}

export function verifyToken(token) {
  if (!token) return false;
  const expiresAt = tokens.get(token);
  if (!expiresAt) return false;
  if (expiresAt < Date.now()) {
    tokens.delete(token);
    return false;
  }
  return true;
}

export function logout(token) {
  tokens.delete(token);
}

function extractToken(req) {
  return req.get('x-admin-token') || req.query.adminToken || req.body?.adminToken || null;
}

export function requireAdmin(req, res, next) {
  if (!verifyToken(extractToken(req))) {
    res.status(401).json({
      error: { message: '管理员未通过验证，请重新输入密码', code: 'UNAUTHORIZED' },
    });
    return;
  }
  next();
}

/** 软鉴权：有合法 token 时标记为管理员，没有也放行 */
export function optionalAdmin(req, res, next) {
  req.isAdmin = verifyToken(extractToken(req));
  next();
}

export { extractToken };
