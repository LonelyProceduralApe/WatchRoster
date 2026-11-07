import os from 'node:os';
import { createApp } from './app.js';
import { HOST, PORT } from './config.js';
import { ensureDataDir } from './lib/store.js';

ensureDataDir();

function lanAddresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

const app = createApp();
const server = app.listen(PORT, HOST);

server.on('listening', () => {
  const lan = lanAddresses();
  console.log('值班排班服务已启动');
  console.log(`  本机地址:   http://127.0.0.1:${PORT}`);
  if (lan.length > 0) {
    console.log(`  局域网地址: ${lan.map((ip) => `http://${ip}:${PORT}`).join('  ')}`);
    console.log('              （真机调试时在「我的 → 修改服务地址」里填这个）');
  }
  console.log(`  健康检查:   http://127.0.0.1:${PORT}/api/health`);
  console.log(`  排班数据:   GET /api/roster?year=2026&month=11`);
  console.log(`  Excel 导出: GET /api/roster/export?year=2026&month=11`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用，可能是服务已在运行。`);
    console.error(`可先访问 http://127.0.0.1:${PORT}/api/health 确认，或用 PORT=3101 换个端口启动。`);
    process.exit(1);
  }
  console.error('服务启动失败:', error);
  process.exit(1);
});

const shutdown = (signal) => {
  console.log(`\n收到 ${signal}，正在关闭服务...`);
  server.close(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
