import { Router } from 'express';
import { HttpError } from '../lib/http.js';
import { createRequest, findRequest, handleRequest, listRequests, summary } from '../lib/swaps.js';
import { requireAdmin } from '../lib/auth.js';

const router = Router();

/** GET /api/swaps?name=张三&status=pending */
router.get('/', (req, res) => {
  res.json({
    requests: listRequests({ name: req.query.name, status: req.query.status }),
  });
});

/** GET /api/swaps/summary?name=张三 —— 换班提醒计数 */
router.get('/summary', (req, res) => {
  res.json(summary(req.query.name));
});

/** POST /api/swaps —— 提交换班申请 */
router.post('/', (req, res) => {
  res.status(201).json({ request: createRequest(req.body ?? {}) });
});

/** POST /api/swaps/:id/approve —— 管理员批准 */
router.post('/:id/approve', requireAdmin, (req, res) => {
  res.json({ request: handleRequest(req.params.id, 'approve', '管理员') });
});

/** POST /api/swaps/:id/reject —— 管理员驳回 */
router.post('/:id/reject', requireAdmin, (req, res) => {
  const reason = String(req.body?.reason ?? '').slice(0, 100);
  res.json({
    request: handleRequest(req.params.id, 'reject', reason ? `管理员：${reason}` : '管理员'),
  });
});

/** POST /api/swaps/:id/cancel —— 申请人撤销 */
router.post('/:id/cancel', (req, res) => {
  const request = findRequest(req.params.id);
  if (!request) throw new HttpError(404, '换班申请不存在', { id: req.params.id });
  const name = String(req.body?.name ?? '').trim();
  if (name && request.requester.name !== name) {
    throw new HttpError(403, '只能撤销自己发起的换班申请');
  }
  res.json({ request: handleRequest(req.params.id, 'cancel', name || request.requester.name) });
});

export default router;
