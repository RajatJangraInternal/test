// ============================================
// Build Script - Creates standalone .exe
// Run: npm run build
// ============================================

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

console.log('==========================================');
console.log('  Building Remote Desktop Service .exe');
console.log('==========================================\n');

// 1. Ensure dist directory
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 2. Install pkg if needed
console.log('[1/3] Installing pkg...');
try {
  execSync('npx -y pkg --version', { stdio: 'pipe', windowsHide: true });
  console.log('  pkg is available.\n');
} catch {
  console.log('  pkg will be downloaded on first use.\n');
}

// 3. Build the executable
console.log('[2/3] Building executable...');
try {
  execSync(
    'npx -y pkg . --target node18-win-x64 --output dist/RemoteDesktop.exe --compress GZip',
    { stdio: 'inherit', cwd: __dirname }
  );
  console.log('\n  Build successful!\n');
} catch (e) {
  console.error('\n  Build failed:', e.message);
  process.exit(1);
}

// 4. Copy public folder to dist (pkg embeds it, but just in case)
console.log('[3/3] Copying assets...');
const publicSrc = path.join(__dirname, 'public');
const publicDst = path.join(distDir, 'public');
if (!fs.existsSync(publicDst)) {
  fs.mkdirSync(publicDst, { recursive: true });
}
copyDirSync(publicSrc, publicDst);
// Copy config
fs.copyFileSync(
  path.join(__dirname, 'config.js'),
  path.join(distDir, 'config.js')
);
console.log('  Assets copied.\n');

console.log('==========================================');
console.log('  BUILD COMPLETE!');
console.log('  Output: dist/RemoteDesktop.exe');
console.log('');
console.log('  To deploy to another computer:');
console.log('  1. Copy the entire "dist" folder');
console.log('  2. Edit config.js to set your password');
console.log('  3. Run RemoteDesktop.exe (as Admin)');
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
