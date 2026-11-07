import express from 'express';
import cors from 'cors';
import rosterRouter from './routes/roster.js';
import calendarRouter from './routes/calendar.js';
import holidaysRouter from './routes/holidays.js';
import configRouter from './routes/config.js';
import swapsRouter from './routes/swaps.js';
import adminRouter from './routes/admin.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  // 导入 Excel 走 base64 上传（云调用下无法上传二进制），放宽到 8MB
  app.use(express.json({ limit: '8mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'watch-roster', time: new Date().toISOString() });
  });

  app.use('/api/roster', rosterRouter);
  app.use('/api/calendar', calendarRouter);
  app.use('/api/holidays', holidaysRouter);
  app.use('/api/config', configRouter);
  app.use('/api/swaps', swapsRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
