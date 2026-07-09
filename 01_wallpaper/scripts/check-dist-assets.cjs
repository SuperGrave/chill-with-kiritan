#!/usr/bin/env node
// check-dist-assets.cjs — distribution safety gate (Tohoku Wallpaper Motion Probe).
//
// The bundled VRM character (public/models/kiritan.vrm = ふらすこ式風東北きりたん)
// and VRMA samples are not redistributable as part of the public package.
// Vite copies everything under public/ into dist/ verbatim, so a plain
// `vite build` can leak restricted assets into dist/.
//
// This script FAILS (exit 1) if any *.vrm/*.vrma survives in dist/. It inspects
// dist/ ONLY — source assets under public/ are never touched.

const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '..', 'dist');

const RESTRICTED_EXTENSIONS = new Set(['.vrm', '.vrma']);

// Recursively collect restricted asset files under `dir` (case-insensitive).
function findRestrictedAssets(dir) {
  const hits = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return hits;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) hits.push(...findRestrictedAssets(full));
    else if (entry.isFile() && RESTRICTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) hits.push(full);
  }
  return hits;
}

if (!fs.existsSync(distDir)) {
  console.log('[check:dist-assets] dist/ not found — run `npm run build` first. Nothing to verify; OK.');
  process.exit(0);
}

const restrictedFiles = findRestrictedAssets(distDir);

if (restrictedFiles.length > 0) {
  console.error('[check:dist-assets] ✗ FAIL: redistribution-prohibited .vrm/.vrma found in dist/:');
  for (const f of restrictedFiles) {
    const kb = (fs.statSync(f).size / 1024).toFixed(1);
    console.error(`    - ${path.relative(distDir, f)} (${kb} KB)`);
  }
  console.error('  Restricted model/motion assets must NOT be shipped in dist/.');
  console.error('  `npm run build` strips it automatically via scripts/strip-dist-vrm.cjs;');
  console.error('  if you ran `vite build` directly, run `npm run build` (or the strip script) instead.');
  process.exit(1);
}

console.log('[check:dist-assets] ✓ OK: no .vrm/.vrma in dist/. Safe to distribute restricted-asset-wise.');
process.exit(0);
