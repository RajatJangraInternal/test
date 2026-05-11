// ============================================
// Input Helper - Mouse/Keyboard via PowerShell
// Uses .NET interop, no native Node modules needed
// ============================================

const { spawn } = require('child_process');

class InputHelper {
  constructor() {
    this.ps = null;
    this.ready = false;
  }

  start() {
    return new Promise((resolve) => {
      this.ps = spawn('powershell.exe', [
        '-NoProfile', '-NoLogo', '-ExecutionPolicy', 'Bypass',
        '-Command', '-'
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      // Load required assemblies and define helper functions
      const initScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class InputSim {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

    public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    public const uint MOUSEEVENTF_LEFTUP = 0x0004;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    public const uint KEYEVENTF_KEYUP = 0x0002;

    public static void MoveTo(int x, int y) { SetCursorPos(x, y); }
    public static void LeftClick() { mouse_event(MOUSEEVENTF_LEFTDOWN,0,0,0,0); mouse_event(MOUSEEVENTF_LEFTUP,0,0,0,0); }
    public static void RightClick() { mouse_event(MOUSEEVENTF_RIGHTDOWN,0,0,0,0); mouse_event(MOUSEEVENTF_RIGHTUP,0,0,0,0); }
    public static void LeftDown() { mouse_event(MOUSEEVENTF_LEFTDOWN,0,0,0,0); }
    public static void LeftUp() { mouse_event(MOUSEEVENTF_LEFTUP,0,0,0,0); }
    public static void RightDown() { mouse_event(MOUSEEVENTF_RIGHTDOWN,0,0,0,0); }
    public static void RightUp() { mouse_event(MOUSEEVENTF_RIGHTUP,0,0,0,0); }
    public static void Scroll(int amount) { mouse_event(MOUSEEVENTF_WHEEL,0,0,amount,0); }
    public static void KeyDown(byte vk) { keybd_event(vk,0,0,0); }
    public static void KeyUp(byte vk) { keybd_event(vk,0,KEYEVENTF_KEYUP,0); }
}
"@
Write-Host "READY"
`;
      this.ps.stdin.write(initScript + '\n');

      const onData = (data) => {
        if (data.toString().includes('READY')) {
          this.ready = true;
          this.ps.stdout.removeListener('data', onData);
          resolve(true);
        }
      };
      this.ps.stdout.on('data', onData);

      this.ps.on('error', () => { this.ready = false; });
      this.ps.on('exit', () => { this.ready = false; });

      // Timeout fallback
      setTimeout(() => { if (!this.ready) { this.ready = true; resolve(true); } }, 5000);
    });
  }

  _send(cmd) {
    if (!this.ready || !this.ps || this.ps.exitCode !== null) return;
    try {
      this.ps.stdin.write(cmd + '\n');
    } catch (e) { /* ignore */ }
  }

  moveTo(x, y) {
    this._send(`[InputSim]::MoveTo(${x},${y})`);
  }

  click(button) {
    if (button === 'right') this._send('[InputSim]::RightClick()');
    else this._send('[InputSim]::LeftClick()');
  }

  doubleClick() {
    this._send('[InputSim]::LeftClick(); Start-Sleep -Milliseconds 50; [InputSim]::LeftClick()');
  }

  mouseDown(button) {
    if (button === 'right') this._send('[InputSim]::RightDown()');
    else this._send('[InputSim]::LeftDown()');
  }

  mouseUp(button) {
    if (button === 'right') this._send('[InputSim]::RightUp()');
    else this._send('[InputSim]::LeftUp()');
  }

  scroll(delta) {
    // Windows WHEEL_DELTA is 120 per notch
    const amount = delta > 0 ? -360 : 360;
    this._send(`[InputSim]::Scroll(${amount})`);
  }

  keyTap(vkCode, modifiers) {
    let cmd = '';
    // Press modifiers
    for (const mod of modifiers) {
      cmd += `[InputSim]::KeyDown(${mod}); `;
    }
    // Tap key
    cmd += `[InputSim]::KeyDown(${vkCode}); [InputSim]::KeyUp(${vkCode}); `;
    // Release modifiers
    for (const mod of modifiers.reverse()) {
      cmd += `[InputSim]::KeyUp(${mod}); `;
    }
    this._send(cmd);
  }

  stop() {
    if (this.ps) {
      try { this.ps.stdin.end(); this.ps.kill(); } catch (e) {}
    }
  }
}

// Virtual key code mapping
const VK = {
  'Backspace': 0x08, 'Tab': 0x09, 'Enter': 0x0D, 'Shift': 0x10,
  'Control': 0x11, 'Alt': 0x12, 'CapsLock': 0x14, 'Escape': 0x1B,
  ' ': 0x20, 'PageUp': 0x21, 'PageDown': 0x22, 'End': 0x23,
  'Home': 0x24, 'ArrowLeft': 0x25, 'ArrowUp': 0x26, 'ArrowRight': 0x27,
  'ArrowDown': 0x28, 'Insert': 0x2D, 'Delete': 0x2E,
  'Meta': 0x5B,
  'F1': 0x70, 'F2': 0x71, 'F3': 0x72, 'F4': 0x73,
  'F5': 0x74, 'F6': 0x75, 'F7': 0x76, 'F8': 0x77,
  'F9': 0x78, 'F10': 0x79, 'F11': 0x7A, 'F12': 0x7B,
};

// Add letters A-Z (0x41 - 0x5A)
for (let i = 0; i < 26; i++) {
  const ch = String.fromCharCode(97 + i); // lowercase
  VK[ch] = 0x41 + i;
  VK[ch.toUpperCase()] = 0x41 + i;
}

// Add digits 0-9 (0x30 - 0x39)
for (let i = 0; i <= 9; i++) {
  VK[String(i)] = 0x30 + i;
}

// Common symbols
Object.assign(VK, {
  ';': 0xBA, '=': 0xBB, ',': 0xBC, '-': 0xBD, '.': 0xBE,
  '/': 0xBF, '`': 0xC0, '[': 0xDB, '\\': 0xDC, ']': 0xDD, "'": 0xDE,
});

module.exports = { InputHelper, VK };
