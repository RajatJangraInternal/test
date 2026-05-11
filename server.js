// ============================================
// Remote Desktop Service - Main Server
// Zero native dependencies - can compile to .exe
// ============================================

// Catch crashes so the .exe window doesn't silently close
process.on('uncaughtException', (err) => {
  const msg = `[CRASH] ${err.stack || err.message || err}`;
  console.error(msg);
  try {
    require('fs').writeFileSync(
      require('path').join(__dirname, 'crash-log.txt'),
      `${new Date().toISOString()}\n${msg}\n`,
      'utf-8'
    );
  } catch {}
  console.error('Press Ctrl+C to close...');
  setInterval(() => {}, 60000);
});
process.on('unhandledRejection', (err) => {
  console.error('[CRASH] Unhandled promise rejection:', err);
});

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const screenshot = require('screenshot-desktop');
const { execSync } = require('child_process');
const config = require('./config');
const { InputHelper, VK } = require('./input-helper');
const { spawn } = require('child_process');
const https = require('https');
const os = require('os');

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
  } catch (e) { }
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
          try { ws.send(imgBuffer, { binary: true }); } catch { }
        }
      } catch (err) {
        console.error('[CAPTURE] Error:', err.message);
      }
    }

    const elapsed = Date.now() - startTime;
    await new Promise((r) => setTimeout(r, Math.max(0, interval - elapsed)));
  }
}

// ---- Cloudflare Tunnel ----
const CONNECTION_INFO_FILE = path.join(__dirname, 'connection-info.txt');
const CLOUDFLARED_PATH = path.join(__dirname, 'cloudflared.exe');
const CLOUDFLARED_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

let tunnelProcess = null;

// Download cloudflared.exe if not present
async function ensureCloudflared() {
  if (fs.existsSync(CLOUDFLARED_PATH)) {
    console.log('[TUNNEL] cloudflared.exe found.');
    return true;
  }

  console.log('[TUNNEL] Downloading cloudflared.exe...');
  return new Promise((resolve) => {
    const file = fs.createWriteStream(CLOUDFLARED_PATH);

    function download(url) {
      https.get(url, (res) => {
        // Follow redirects
        if (res.statusCode === 301 || res.statusCode === 302) {
          return download(res.headers.location);
        }
        if (res.statusCode !== 200) {
          console.error(`[TUNNEL] Download failed: HTTP ${res.statusCode}`);
          file.close();
          try { fs.unlinkSync(CLOUDFLARED_PATH); } catch {}
          return resolve(false);
        }

        const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        let downloaded = 0;

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          if (totalBytes > 0) {
            const pct = Math.round((downloaded / totalBytes) * 100);
            process.stdout.write(`\r[TUNNEL] Downloading... ${pct}%`);
          }
        });

        res.pipe(file);
        file.on('finish', () => {
          file.close();
          console.log('\n[TUNNEL] cloudflared.exe downloaded successfully.');
          resolve(true);
        });
      }).on('error', (err) => {
        file.close();
        try { fs.unlinkSync(CLOUDFLARED_PATH); } catch {}
        console.error('[TUNNEL] Download error:', err.message);
        resolve(false);
      });
    }

    download(CLOUDFLARED_URL);
  });
}

async function startTunnel() {
  if (!config.CLOUDFLARE_TUNNEL_ENABLED) return;

  const ready = await ensureCloudflared();
  if (!ready) {
    console.log('[TUNNEL] Cannot start tunnel without cloudflared.exe');
    return;
  }

  const args = [];

  if (config.CLOUDFLARE_TUNNEL_TOKEN) {
    // Named tunnel mode: permanent subdomain on your domain
    args.push('tunnel', 'run', '--token', config.CLOUDFLARE_TUNNEL_TOKEN);
    console.log('[TUNNEL] Starting named Cloudflare Tunnel...');
  } else {
    // Quick tunnel mode: random *.trycloudflare.com URL
    args.push('tunnel', '--url', `http://localhost:${config.PORT}`);
    console.log('[TUNNEL] Starting quick Cloudflare Tunnel (random URL)...');
  }

  tunnelProcess = spawn(CLOUDFLARED_PATH, args, {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let tunnelUrl = null;

  // Parse output for the tunnel URL
  const handleOutput = (data) => {
    const text = data.toString();
    // cloudflared logs the URL in various formats
    const urlMatch = text.match(/https:\/\/[\w.-]+\.trycloudflare\.com/);
    if (urlMatch && !tunnelUrl) {
      tunnelUrl = urlMatch[0];
      writeConnectionFile(tunnelUrl);
    }

    // Log cloudflared output for debugging
    const lines = text.split('\n').filter(l => l.trim());
    lines.forEach(line => {
      // Only log important lines
      if (line.includes('https://') || line.includes('ERR') ||
          line.includes('Starting') || line.includes('Registered') ||
          line.includes('Connection')) {
        console.log(`[TUNNEL] ${line.trim()}`);
      }
    });
  };

  tunnelProcess.stdout.on('data', handleOutput);
  tunnelProcess.stderr.on('data', handleOutput);

  tunnelProcess.on('error', (err) => {
    console.error('[TUNNEL] Failed to start cloudflared:', err.message);
  });

  tunnelProcess.on('exit', (code) => {
    console.log(`[TUNNEL] cloudflared exited with code ${code}`);
    tunnelProcess = null;
  });

  // For named tunnel mode, write connection info immediately
  if (config.CLOUDFLARE_TUNNEL_TOKEN && config.CLOUDFLARE_TUNNEL_HOSTNAME) {
    const url = `https://${config.CLOUDFLARE_TUNNEL_HOSTNAME}`;
    writeConnectionFile(url);
  }
}

function writeConnectionFile(url) {
  const interfaces = os.networkInterfaces();
  const localIPs = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIPs.push({ name, address: iface.address });
      }
    }
  }

  const lines = [
    '==========================================',
    '  Remote Desktop - Connection Info',
    '==========================================',
    '',
    '  --- REMOTE ACCESS (ANY NETWORK) ---',
    `  URL: ${url}`,
    '',
    '  --- LOCAL ACCESS (SAME NETWORK) ---',
    ...localIPs.map(ip => `  http://${ip.address}:${config.PORT}  (${ip.name})`),
    '',
    `  Password: ${config.PASSWORD}`,
    `  Generated: ${new Date().toLocaleString()}`,
    '',
    '  Open the URL above in any browser to',
    '  access this computer from anywhere.',
    '==========================================',
  ].join('\n');

  fs.writeFileSync(CONNECTION_INFO_FILE, lines, 'utf-8');

  console.log('================================================');
  console.log('  CLOUDFLARE TUNNEL ACTIVE');
  console.log(`  URL: ${url}`);
  console.log(`  Saved to: ${CONNECTION_INFO_FILE}`);
  console.log('================================================');
}

function stopTunnel() {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill('SIGTERM');
      // On Windows, force kill after a short delay
      setTimeout(() => {
        try { tunnelProcess?.kill('SIGKILL'); } catch {}
      }, 2000);
    } catch {}
    tunnelProcess = null;
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

  server.listen(config.PORT, '0.0.0.0', async () => {
    console.log('================================================');
    console.log('  Remote Desktop Service - Running');
    console.log(`  Port: ${config.PORT} | FPS: ${config.FPS}`);
    console.log(`  Input: ${inputAvailable ? 'ON' : 'OFF'}`);
    console.log('================================================');

    // Start Cloudflare Tunnel
    await startTunnel();

    captureLoop();
  });
}

main();

process.on('SIGINT', () => {
  captureRunning = false;
  input.stop();
  stopTunnel();
  wss.close();
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  captureRunning = false;
  input.stop();
  stopTunnel();
  wss.close();
  server.close();
  process.exit(0);
});
