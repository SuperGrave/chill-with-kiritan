#!/usr/bin/env node
// strip-dist-vrm.cjs — remove redistribution-prohibited VRM(s) from the build output.
//
// Runs automatically after `vite build` (see package.json "build"). Vite copies
// public/ into dist/ verbatim, which would otherwise leak public/models/kiritan.vrm
// (ふらすこ式風東北きりたん — redistribution prohibited) into the shippable dist/.
// This deletes any *.vrm under dist/ so the build output is always safe to ship.
// Source assets under public/ are NEVER touched — only dist/.
//
// Idempotent and never fails the build: if dist/ (or the model) is absent, it
// simply reports there was nothing to remove. The hard guarantee that no VRM
// remains is enforced separately by scripts/check-dist-assets.cjs.

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
  console.log('[strip-dist-vrm] dist/ not found — nothing to strip.');
  process.exit(0);
}

const vrmFiles = findVrm(distDir);

if (vrmFiles.length === 0) {
  console.log('[strip-dist-vrm] no .vrm in dist/ — nothing to strip.');
  process.exit(0);
}

let freedKB = 0;
for (const f of vrmFiles) {
  const kb = fs.statSync(f).size / 1024;
  fs.rmSync(f);
  freedKB += kb;
  console.log(`[strip-dist-vrm] removed ${path.relative(distDir, f)} (${kb.toFixed(1)} KB)`);
}
console.log(
  `[strip-dist-vrm] ✓ stripped ${vrmFiles.length} .vrm file(s) from dist/ (${freedKB.toFixed(1)} KB freed).`,
);
process.exit(0);
