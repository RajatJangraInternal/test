// ============================================
// Remote Desktop Service - Browser Client
// ============================================

(function () {
  'use strict';

  // DOM elements
  const loginScreen = document.getElementById('login-screen');
  const desktopScreen = document.getElementById('desktop-screen');
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password-input');
  const loginError = document.getElementById('login-error');
  const canvas = document.getElementById('remote-canvas');
  const ctx = canvas.getContext('2d');
  const fpsCounter = document.getElementById('fps-counter');
  const latencyDisplay = document.getElementById('latency-display');
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const disconnectBtn = document.getElementById('disconnect-btn');
  const reconnectOverlay = document.getElementById('reconnect-overlay');
  const canvasContainer = document.getElementById('canvas-container');

  let ws = null;
  let screenSize = { width: 1920, height: 1080 };
  let inputEnabled = false;
  let authenticated = false;
  let frameCount = 0;
  let lastFpsUpdate = Date.now();
  let reconnectTimer = null;
  let password = '';

  // ---- Connection ----

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('[WS] Connected');
      // Authenticate
      ws.send(JSON.stringify({ type: 'auth', password: password }));
    };

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } else {
        // Binary = screenshot frame
        renderFrame(event.data);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      if (authenticated) {
        showReconnect(true);
        scheduleReconnect();
      }
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };
  }

  function disconnect() {
    authenticated = false;
    clearTimeout(reconnectTimer);
    if (ws) {
      ws.close();
      ws = null;
    }
    showReconnect(false);
    showScreen('login');
    loginError.textContent = '';
    passwordInput.value = '';
  }

  function scheduleReconnect() {
    reconnectTimer = setTimeout(() => {
      console.log('[WS] Reconnecting...');
      connect();
    }, 2000);
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'auth_result':
        if (msg.success) {
          authenticated = true;
          screenSize = msg.screen || screenSize;
          inputEnabled = msg.inputEnabled;
          canvas.width = screenSize.width;
          canvas.height = screenSize.height;
          showScreen('desktop');
          showReconnect(false);
          updateStatus('Connected', true);
        } else {
          loginError.textContent = msg.error || 'Authentication failed';
          shakeCard();
        }
        break;
    }
  }

  // ---- Rendering ----

  const frameImage = new Image();

  function renderFrame(buffer) {
    const blob = new Blob([buffer], { type: 'image/png' });
    const url = URL.createObjectURL(blob);

    frameImage.onload = () => {
      // Resize canvas if needed
      if (canvas.width !== frameImage.width || canvas.height !== frameImage.height) {
        canvas.width = frameImage.width;
        canvas.height = frameImage.height;
      }
      ctx.drawImage(frameImage, 0, 0);
      URL.revokeObjectURL(url);

      // FPS tracking
      frameCount++;
      const now = Date.now();
      if (now - lastFpsUpdate >= 1000) {
        fpsCounter.textContent = frameCount + ' FPS';
        frameCount = 0;
        lastFpsUpdate = now;
      }
    };

    frameImage.src = url;
  }

  // ---- Input forwarding ----

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function getMouseButton(btn) {
    switch (btn) {
      case 0: return 'left';
      case 1: return 'middle';
      case 2: return 'right';
      default: return 'left';
    }
  }

  function sendInput(msg) {
    if (ws && ws.readyState === WebSocket.OPEN && authenticated && inputEnabled) {
      ws.send(JSON.stringify(msg));
    }
  }

  // Mouse events on canvas
  canvasContainer.addEventListener('mousemove', (e) => {
    const c = getCanvasCoords(e);
    sendInput({ type: 'mouse', action: 'move', x: c.x, y: c.y });
  });

  canvasContainer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const c = getCanvasCoords(e);
    sendInput({ type: 'mouse', action: 'down', x: c.x, y: c.y, button: getMouseButton(e.button) });
  });

  canvasContainer.addEventListener('mouseup', (e) => {
    e.preventDefault();
    const c = getCanvasCoords(e);
    sendInput({ type: 'mouse', action: 'up', x: c.x, y: c.y, button: getMouseButton(e.button) });
  });

  canvasContainer.addEventListener('click', (e) => {
    const c = getCanvasCoords(e);
    sendInput({ type: 'mouse', action: 'click', x: c.x, y: c.y, button: getMouseButton(e.button) });
  });

  canvasContainer.addEventListener('dblclick', (e) => {
    e.preventDefault();
    const c = getCanvasCoords(e);
    sendInput({ type: 'mouse', action: 'dblclick', x: c.x, y: c.y, button: 'left' });
  });

  canvasContainer.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  canvasContainer.addEventListener('wheel', (e) => {
    e.preventDefault();
    sendInput({ type: 'scroll', deltaY: e.deltaY });
  }, { passive: false });

  // Keyboard events (global when desktop is visible)
  document.addEventListener('keydown', (e) => {
    if (!authenticated) return;
    // Don't capture F11 (browser fullscreen) or F12 (devtools)
    if (e.key === 'F11' || e.key === 'F12') return;
    e.preventDefault();
    sendInput({
      type: 'keyboard',
      action: 'down',
      key: e.key,
      code: e.code,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey,
    });
  });

  document.addEventListener('keyup', (e) => {
    if (!authenticated) return;
    if (e.key === 'F11' || e.key === 'F12') return;
    e.preventDefault();
    sendInput({
      type: 'keyboard',
      action: 'up',
      key: e.key,
      code: e.code,
      ctrl: e.ctrlKey,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey,
    });
  });

  // ---- UI helpers ----

  function showScreen(name) {
    loginScreen.classList.toggle('active', name === 'login');
    desktopScreen.classList.toggle('active', name === 'desktop');
  }

  function showReconnect(show) {
    reconnectOverlay.classList.toggle('active', show);
  }

  function updateStatus(text, ok) {
    statusText.textContent = text;
    statusDot.style.background = ok ? 'var(--ok)' : 'var(--danger)';
    statusDot.style.boxShadow = ok ? '0 0 8px var(--ok)' : '0 0 8px var(--danger)';
  }

  function shakeCard() {
    const card = document.querySelector('.login-card');
    card.style.animation = 'none';
    card.offsetHeight; // trigger reflow
    card.style.animation = 'shake 0.4s ease';
  }

  // Add shake animation
  const style = document.createElement('style');
  style.textContent = '@keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-8px)}40%,80%{transform:translateX(8px)}}';
  document.head.appendChild(style);

  // ---- Event handlers ----

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    password = passwordInput.value.trim();
    if (!password) return;
    loginError.textContent = '';
    connect();
  });

  fullscreenBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  disconnectBtn.addEventListener('click', () => {
    disconnect();
  });

  // Focus password input
  passwordInput.focus();
})();
