// ============================================
// Uninstall the Windows Service
// Run: npm run uninstall-service (as Administrator)
// ============================================

const path = require('path');
const Service = require('node-windows').Service;
const config = require('./config');

const svc = new Service({
  name: config.SERVICE_NAME,
  script: path.join(__dirname, 'server.js'),
});

svc.on('uninstall', () => {
  console.log(`[OK] Service "${config.SERVICE_NAME}" uninstalled.`);
});

svc.on('error', (err) => {
  console.error('[ERR] Uninstall error:', err);
});

console.log(`Uninstalling service "${config.SERVICE_NAME}"...`);
svc.uninstall();
