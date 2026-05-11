// ============================================
// Install as a hidden Windows Service
// Run: npm run install-service (as Administrator)
// ============================================

const path = require('path');
const Service = require('node-windows').Service;
const config = require('./config');

const svc = new Service({
  name: config.SERVICE_NAME,
  description: config.SERVICE_DESCRIPTION,
  script: path.join(__dirname, 'server.js'),
  nodeOptions: [],
  env: [{ name: 'NODE_ENV', value: 'production' }],
});

svc.on('install', () => {
  console.log(`[OK] Service "${config.SERVICE_NAME}" installed.`);
  svc.start();
  console.log('[OK] Service started.');
});

svc.on('alreadyinstalled', () => {
  console.log('[INFO] Service is already installed.');
});

svc.on('error', (err) => {
  console.error('[ERR] Installation error:', err);
});

console.log(`Installing service "${config.SERVICE_NAME}"...`);
svc.install();
