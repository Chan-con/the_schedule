/* eslint-env node */

const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const srcIco = path.join(repoRoot, 'asset', 'icon.ico');
  const srcPng = path.join(repoRoot, 'asset', 'icon.PNG');
  const publicDir = path.join(repoRoot, 'public');

  const destFavicon = path.join(publicDir, 'favicon.ico');
  const destPng = path.join(publicDir, 'icon.png');

  if (fs.existsSync(srcIco)) {
    copyFile(srcIco, destFavicon);
  } else {
    console.warn('[copy-web-assets] missing:', srcIco);
  }

  // Optional: expose a PNG too (useful for platforms that prefer png icons)
  if (fs.existsSync(srcPng)) {
    copyFile(srcPng, destPng);
  }
}

main();
