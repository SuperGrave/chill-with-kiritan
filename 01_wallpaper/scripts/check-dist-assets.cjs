#!/usr/bin/env node
// check-dist-assets.cjs — distribution safety gate (Tohoku Wallpaper Motion Probe).
//
// The bundled VRM character (public/models/kiritan.vrm = ふらすこ式風東北きりたん) is
// REDISTRIBUTION-PROHIBITED — see public/models/README_MODEL_PLACEMENT.md and
// docs/VRM_MODEL_AUDIT_flasco_kiritan.md. Vite copies everything under public/
// into dist/ verbatim, so a plain `vite build` leaks the model into dist/.
//
// This script FAILS (exit 1) if any *.vrm survives in dist/, so a dist/ that
// still contains the model can never be shipped by mistake. It inspects dist/
// ONLY — source assets under public/ are never touched.

const fs = require('fs');
const path = require('path');

const distDir = path.resolve(__dirname, '..', 'dist');

// Recursively collect every *.vrm file under `dir` (case-insensitive).
function findVrm(dir) {
  const hits = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return hits;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) hits.push(...findVrm(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.vrm')) hits.push(full);
  }
  return hits;
}

if (!fs.existsSync(distDir)) {
  console.log('[check:dist-assets] dist/ not found — run `npm run build` first. Nothing to verify; OK.');
  process.exit(0);
}

const vrmFiles = findVrm(distDir);

if (vrmFiles.length > 0) {
  console.error('[check:dist-assets] ✗ FAIL: redistribution-prohibited .vrm found in dist/:');
  for (const f of vrmFiles) {
    const kb = (fs.statSync(f).size / 1024).toFixed(1);
    console.error(`    - ${path.relative(distDir, f)} (${kb} KB)`);
  }
  console.error('  The VRM model must NOT be shipped in dist/ (redistribution prohibited).');
  console.error('  `npm run build` strips it automatically via scripts/strip-dist-vrm.cjs;');
  console.error('  if you ran `vite build` directly, run `npm run build` (or the strip script) instead.');
  process.exit(1);
}

console.log('[check:dist-assets] ✓ OK: no .vrm in dist/. Safe to distribute (re: model license).');
process.exit(0);
