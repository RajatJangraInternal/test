// ============================================
// Build Script - Creates standalone .exe
// Uses esbuild + Node.js SEA (Single Executable Application)
// Run: npm run build
// ============================================

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
const bundlePath = path.join(distDir, 'bundle.js');
const seaConfigPath = path.join(distDir, 'sea-config.json');
const seaBlobPath = path.join(distDir, 'sea-prep.blob');
const exePath = path.join(distDir, 'RemoteDesktop.exe');
const nodePath = process.execPath; // path to current node.exe

console.log('==========================================');
console.log('  Building Remote Desktop Service .exe');
console.log('  Using: esbuild + Node.js SEA');
console.log('==========================================\n');

// 1. Ensure dist directory
if (fs.existsSync(distDir)) {
  // Clean previous build artifacts
  for (const f of ['bundle.js', 'sea-config.json', 'sea-prep.blob']) {
    const p = path.join(distDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
} else {
  fs.mkdirSync(distDir, { recursive: true });
}

// 2. Install esbuild if needed
console.log('[1/5] Ensuring esbuild is available...');
try {
  execSync('npx -y esbuild --version', { stdio: 'pipe', windowsHide: true });
  console.log('  esbuild is available.\n');
} catch {
  console.log('  esbuild will be downloaded on first use.\n');
}

// 3. Bundle with esbuild (all dependencies into a single file)
console.log('[2/5] Bundling with esbuild...');
try {
  execSync(
    `npx -y esbuild server.js --bundle --platform=node --target=node18 --outfile="${bundlePath}" --external:screenshot-desktop`,
    { stdio: 'inherit', cwd: __dirname }
  );
  console.log('  Bundle created.\n');
} catch (e) {
  console.error('  Bundle failed:', e.message);
  process.exit(1);
}

// 4. Copy assets that can't be bundled
console.log('[3/5] Copying assets...');

// Copy public folder
const publicSrc = path.join(__dirname, 'public');
const publicDst = path.join(distDir, 'public');
copyDirSync(publicSrc, publicDst);

// Copy config.js (so user can edit it in dist)
fs.copyFileSync(
  path.join(__dirname, 'config.js'),
  path.join(distDir, 'config.js')
);

// Copy input-helper.js
fs.copyFileSync(
  path.join(__dirname, 'input-helper.js'),
  path.join(distDir, 'input-helper.js')
);

// Copy screenshot-desktop (native module, must be external)
const screenshotSrc = path.join(__dirname, 'node_modules', 'screenshot-desktop');
const screenshotDst = path.join(distDir, 'node_modules', 'screenshot-desktop');
copyDirSync(screenshotSrc, screenshotDst);

console.log('  Assets copied.\n');

// 5. Create SEA config
console.log('[4/5] Creating SEA blob...');
const seaConfig = {
  main: bundlePath,
  output: seaBlobPath,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: true,
};
fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));

// Generate the SEA blob
try {
  execSync(`node --experimental-sea-config "${seaConfigPath}"`, {
    stdio: 'inherit',
    cwd: distDir,
  });
  console.log('  SEA blob created.\n');
} catch (e) {
  console.error('  SEA blob creation failed:', e.message);
  process.exit(1);
}

// 6. Create the executable
console.log('[5/5] Creating executable...');
try {
  // Copy node.exe as our base
  fs.copyFileSync(nodePath, exePath);

  // Remove the signature (required on Windows before injecting)
  try {
    execSync(`npx -y postject --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 "${exePath}" NODE_SEA_BLOB "${seaBlobPath}" --overwrite`, {
      stdio: 'inherit',
      cwd: distDir,
    });
  } catch (e) {
    console.error('  Postject injection failed:', e.message);
    process.exit(1);
  }

  console.log('\n  Executable created!\n');
} catch (e) {
  console.error('  Failed to create executable:', e.message);
  process.exit(1);
}

// 7. Cleanup temp files
try {
  fs.unlinkSync(bundlePath);
  fs.unlinkSync(seaConfigPath);
  fs.unlinkSync(seaBlobPath);
} catch {}

console.log('==========================================');
console.log('  BUILD COMPLETE!');
console.log(`  Output: ${exePath}`);
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
