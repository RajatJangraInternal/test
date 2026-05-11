// ============================================
// Build Script - Creates portable deployment folder
// Includes node.exe so target PC needs NO install
// Run: npm run build
// ============================================

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
const nodePath = process.execPath;

console.log('==========================================');
console.log('  Building Remote Desktop Service');
console.log('==========================================\n');

// 1. Clean and create dist directory
console.log('[1/4] Preparing dist folder...');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });
console.log('  Done.\n');

// 2. Copy source files
console.log('[2/4] Copying source files...');
const filesToCopy = ['server.js', 'config.js', 'input-helper.js', 'package.json'];
for (const file of filesToCopy) {
  fs.copyFileSync(path.join(__dirname, file), path.join(distDir, file));
  console.log(`  Copied ${file}`);
}
// Copy public folder
copyDirSync(path.join(__dirname, 'public'), path.join(distDir, 'public'));
console.log('  Copied public/');
console.log('');

// 3. Install production dependencies in dist
console.log('[3/4] Installing dependencies (production only)...');
try {
  execSync('npm install --production --no-optional', {
    stdio: 'inherit',
    cwd: distDir,
    windowsHide: true,
  });
  console.log('\n  Dependencies installed.\n');
} catch (e) {
  console.error('  npm install failed:', e.message);
  process.exit(1);
}

// 4. Copy node.exe and create launcher
console.log('[4/4] Creating launcher...');

// Copy node.exe for portability
fs.copyFileSync(nodePath, path.join(distDir, 'node.exe'));
console.log('  Copied node.exe');

// Create RemoteDesktop.bat launcher
const batContent = [
  '@echo off',
  'cd /d "%~dp0"',
  'node.exe server.js',
  'pause',
].join('\r\n');
fs.writeFileSync(path.join(distDir, 'RemoteDesktop.bat'), batContent);
console.log('  Created RemoteDesktop.bat');

// Create a silent/hidden launcher (RemoteDesktop-Silent.vbs)
const vbsContent = [
  'Set fso = CreateObject("Scripting.FileSystemObject")',
  'dir = fso.GetParentFolderName(WScript.ScriptFullName)',
  'Set shell = CreateObject("WScript.Shell")',
  'shell.Run Chr(34) & dir & "\\node.exe" & Chr(34) & " " & Chr(34) & dir & "\\server.js" & Chr(34), 0, False',
].join('\r\n');
fs.writeFileSync(path.join(distDir, 'RemoteDesktop-Silent.vbs'), vbsContent);
console.log('  Created RemoteDesktop-Silent.vbs (runs hidden)');

// Remove unnecessary files from dist
try {
  const distPkg = path.join(distDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(distPkg, 'utf-8'));
  delete pkg.devDependencies;
  delete pkg.pkg;
  delete pkg.scripts;
  fs.writeFileSync(distPkg, JSON.stringify(pkg, null, 2));
} catch {}

console.log('\n==========================================');
console.log('  BUILD COMPLETE!');
console.log('  Output: dist/');
console.log('');
console.log('  Contents:');
console.log('    RemoteDesktop.bat       - Run with console');
console.log('    RemoteDesktop-Silent.vbs - Run hidden (no window)');
console.log('    config.js               - Edit password/settings');
console.log('');
console.log('  To deploy to another computer:');
console.log('  1. Copy the entire "dist" folder');
console.log('  2. Edit config.js to set your password');
console.log('  3. Right-click RemoteDesktop.bat → Run as Admin');
console.log('==========================================');

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
