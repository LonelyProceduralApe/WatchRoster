import { Router } from 'express';
import { asyncHandler } from '../lib/http.js';
import { buildRosterForQuery } from '../services/rosterService.js';
import { buildTemplateBuffer, buildWorkbookBuffer } from '../lib/excel.js';

const router = Router();

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 输出 Excel：默认直接下载；
 * 加 ?format=base64 返回 { fileName, contentBase64 }，
 * 供小程序用 wx.cloud.callContainer（云调用拿不到二进制流）时写本地文件再打开。
 */
function sendWorkbook(req, res, buffer, asciiName, cnName) {
  const body = Buffer.from(buffer);
  if (req.query.format === 'base64') {
    res.json({ fileName: cnName, contentBase64: body.toString('base64') });
    return;
  }
  res.setHeader('Content-Type', XLSX_TYPE);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(cnName)}`,
  );
  res.setHeader('Content-Length', body.byteLength);
  res.end(body);
}

/** GET /api/roster?startDate=&endDate= 或 ?year=&month= */
router.get('/', (req, res) => {
  res.json(buildRosterForQuery(req.query));
});

/** GET /api/roster/template 下载导入模板 */
router.get(
  '/template',
  asyncHandler(async (req, res) => {
    const buffer = await buildTemplateBuffer();
    sendWorkbook(req, res, buffer, 'roster_template.xlsx', '值班表模板.xlsx');
  }),
);

/** GET /api/roster/export?... 下载 Excel 值班表 */
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const roster = buildRosterForQuery(req.query);
    const buffer = await buildWorkbookBuffer(roster);
    const asciiName = `roster_${roster.meta.startDate}_${roster.meta.endDate}.xlsx`;
    const cnName = `值班表_${roster.meta.startDate}_${roster.meta.endDate}.xlsx`;
    sendWorkbook(req, res, buffer, asciiName, cnName);
  }),
);

export default router;
