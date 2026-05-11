// ============================================
// Remote Desktop Service - Main Server
// Zero native dependencies - can compile to .exe
// ============================================

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const screenshot = require('screenshot-desktop');
const { execSync } = require('child_process');
const config = require('./config');
const { InputHelper, VK } = require('./input-helper');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Serve static web client
app.use(express.static(path.join(__dirname, 'public')));

// Input helper instance
const input = new InputHelper();
let inputAvailable = false;

// Track authenticated clients
const authenticatedClients = new Set();

// Screen dimensions
let screenSize = { width: 1920, height: 1080 };
try {
  const out = execSync(
    'powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Screen]::PrimaryScreen.Bounds | Select Width,Height | ConvertTo-Json"',
    { windowsHide: true, timeout: 5000 }
  ).toString().trim();
  const parsed = JSON.parse(out);
  if (parsed.Width && parsed.Height) {
    screenSize = { width: parsed.Width, height: parsed.Height };
  }
} catch (e) { /* use defaults */ }

// ---- Auto Setup ----
function autoSetup() {
  console.log('[SETUP] Running auto-setup...');

  // Add firewall rule
  try {
    const ruleName = 'RemoteDesktopSvc_' + config.PORT;
    const checkCmd = `netsh advfirewall firewall show rule name="${ruleName}" >nul 2>&1`;
    try {
      execSync(checkCmd, { windowsHide: true, stdio: 'pipe' });
      console.log('[SETUP] Firewall rule already exists.');
    } catch {
      try {
        execSync(
          `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${config.PORT}`,
          { windowsHide: true, stdio: 'pipe' }
        );
        console.log('[SETUP] Firewall rule added for port ' + config.PORT);
      } catch (e) {
        console.log('[SETUP] Could not add firewall rule (need admin). Run as Administrator for auto-setup.');
      }
    }
  } catch (e) {
    console.log('[SETUP] Firewall setup skipped.');
  }

  // Get local IP addresses
  try {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          ips.push({ name, address: iface.address });
        }
      }
    }
    if (ips.length > 0) {
      console.log('[SETUP] Access from other computers using:');
      ips.forEach(ip => {
        console.log(`  http://${ip.address}:${config.PORT}  (${ip.name})`);
      });
    }
  } catch (e) {}
}

// ---- WebSocket handling ----
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`[CONN] New connection from ${clientIp}`);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    switch (msg.type) {
      case 'auth':
        handleAuth(ws, msg);
        break;
      case 'mouse':
        if (authenticatedClients.has(ws)) handleMouse(msg);
        break;
      case 'keyboard':
        if (authenticatedClients.has(ws)) handleKeyboard(msg);
        break;
      case 'scroll':
        if (authenticatedClients.has(ws)) handleScroll(msg);
        break;
    }
  });

  ws.on('close', () => {
    authenticatedClients.delete(ws);
    console.log(`[DISC] Client ${clientIp} disconnected`);
  });

  ws.on('error', () => { authenticatedClients.delete(ws); });
});

// Heartbeat
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

// ---- Authentication ----
function handleAuth(ws, msg) {
  if (msg.password === config.PASSWORD) {
    authenticatedClients.add(ws);
    ws.send(JSON.stringify({
      type: 'auth_result',
      success: true,
      screen: screenSize,
      inputEnabled: config.ENABLE_INPUT && inputAvailable,
    }));
    console.log('[AUTH] Client authenticated');
  } else {
    ws.send(JSON.stringify({
      type: 'auth_result',
      success: false,
      error: 'Invalid password',
    }));
  }
}

// ---- Input Forwarding ----
function handleMouse(msg) {
  if (!config.ENABLE_INPUT || !inputAvailable) return;
  const x = Math.round(msg.x);
  const y = Math.round(msg.y);

  switch (msg.action) {
    case 'move':
      input.moveTo(x, y);
      break;
    case 'click':
      input.moveTo(x, y);
      input.click(msg.button || 'left');
      break;
    case 'dblclick':
      input.moveTo(x, y);
      input.doubleClick();
      break;
    case 'down':
      input.moveTo(x, y);
      input.mouseDown(msg.button || 'left');
      break;
    case 'up':
      input.moveTo(x, y);
      input.mouseUp(msg.button || 'left');
      break;
  }
}

function handleScroll(msg) {
  if (!config.ENABLE_INPUT || !inputAvailable) return;
  input.scroll(msg.deltaY);
}

function handleKeyboard(msg) {
  if (!config.ENABLE_INPUT || !inputAvailable) return;
  if (msg.action !== 'down') return;

  const vk = VK[msg.key];
  if (!vk) return;

  const modifiers = [];
  if (msg.ctrl) modifiers.push(VK['Control']);
  if (msg.shift) modifiers.push(VK['Shift']);
  if (msg.alt) modifiers.push(VK['Alt']);
  if (msg.meta) modifiers.push(VK['Meta']);

  input.keyTap(vk, modifiers);
}

// ---- Screen Capture Loop ----
let captureRunning = false;

async function captureLoop() {
  if (captureRunning) return;
  captureRunning = true;

  const interval = Math.floor(1000 / config.FPS);

  while (captureRunning) {
    const startTime = Date.now();

    const activeClients = [...authenticatedClients].filter(
      (ws) => ws.readyState === ws.OPEN
    );

    if (activeClients.length > 0) {
      try {
        // Capture screenshot as PNG buffer
        const imgBuffer = await screenshot({ format: 'png' });

        // Send PNG directly (no sharp needed)
        for (const ws of activeClients) {
          try { ws.send(imgBuffer, { binary: true }); } catch {}
        }
      } catch (err) {
        console.error('[CAPTURE] Error:', err.message);
      }
    }

    const elapsed = Date.now() - startTime;
    await new Promise((r) => setTimeout(r, Math.max(0, interval - elapsed)));
  }
}

// ---- Start Server ----
async function main() {
  autoSetup();

  // Initialize input helper
  if (config.ENABLE_INPUT) {
    try {
      await input.start();
      inputAvailable = true;
      console.log('[OK] Input forwarding ready (PowerShell)');
    } catch (e) {
      console.log('[WARN] Input forwarding unavailable');
    }
  }

  server.listen(config.PORT, '0.0.0.0', () => {
    console.log('================================================');
    console.log('  Remote Desktop Service - Running');
    console.log(`  Port: ${config.PORT} | FPS: ${config.FPS}`);
    console.log(`  Input: ${inputAvailable ? 'ON' : 'OFF'}`);
    console.log('================================================');
    captureLoop();
  });
}

main();

process.on('SIGINT', () => {
  captureRunning = false;
  input.stop();
  wss.close();
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  captureRunning = false;
  input.stop();
  wss.close();
  server.close();
  process.exit(0);
});
