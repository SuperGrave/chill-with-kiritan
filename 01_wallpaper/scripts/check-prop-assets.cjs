#!/usr/bin/env node
// check-prop-assets.cjs — prop asset registry sanity gate (Premium Props Prep 0.7).
//
// Validates public/models/props/props.manifest.json against the filesystem:
//   * ASSET_CREDITS.md must exist (the license ledger is mandatory) ........ exit 1
//   * props.manifest.json must exist + parse as JSON ....................... exit 1
//   * the BASIC set's desk/chair/laptop must all resolve to real files ..... exit 1
//   * PREMIUM entries that name a path but whose file is missing ........... WARN only
//     (premium models are user-supplied later; absence is expected here, and
//      the runtime loader falls back to a placeholder box anyway)
//   * null PREMIUM entries are reported as "reserved, not provided" ........ info
//
// Inspects public/ only (mirrors scripts/check-dist-assets.cjs). Reading the
// manifest AT RUNTIME is intentionally NOT implemented in 0.7 (preparation only):
// scene.json still drives prop loading. Run via: npm run check:props.

const fs = require('fs');
const path = require('path');

const publicDir = path.resolve(__dirname, '..', 'public');
const propsDir = path.join(publicDir, 'models', 'props');
const manifestPath = path.join(propsDir, 'props.manifest.json');
const creditsPath = path.join(propsDir, 'ASSET_CREDITS.md');

let failed = false;
const fail = (msg) => { console.error('  ✗ ' + msg); failed = true; };
const warn = (msg) => console.warn('  ⚠ ' + msg);
const ok = (msg) => console.log('  ✓ ' + msg);

console.log('[check:props] validating prop asset registry...');

// 1. ASSET_CREDITS.md present (license ledger is mandatory).
if (!fs.existsSync(creditsPath)) {
  fail('ASSET_CREDITS.md missing — the license ledger is required at public/models/props/ASSET_CREDITS.md.');
} else {
  ok('ASSET_CREDITS.md present (license ledger).');
}

// 2. manifest present + parseable.
let manifest = null;
if (!fs.existsSync(manifestPath)) {
  fail('props.manifest.json missing at public/models/props/props.manifest.json.');
} else {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    ok('props.manifest.json parsed.');
  } catch (e) {
    fail('props.manifest.json is not valid JSON: ' + e.message);
  }
}

// Map a web-absolute manifest path ("/models/props/x.glb") to a filesystem path.
const resolveAsset = (webPath) => path.join(publicDir, String(webPath).replace(/^\//, ''));

if (manifest) {
  const sets = (manifest && typeof manifest.sets === 'object' && manifest.sets) || {};
  const basic = (sets.basic && typeof sets.basic === 'object' && sets.basic) || {};
  const premium = (sets.premium && typeof sets.premium === 'object' && sets.premium) || {};

  if (!sets.basic) fail('manifest.sets.basic is missing — the basic set must be defined.');

  // 3. activeSet sanity (non-blocking).
  if (!manifest.activeSet || !sets[manifest.activeSet]) {
    warn(`activeSet "${manifest.activeSet}" is not a defined set (consumers should default to "basic").`);
  } else {
    ok(`activeSet = "${manifest.activeSet}".`);
  }

  // 4. basic required trio must exist on disk.
  const required = ['desk', 'chair', 'laptop'];
  for (const id of required) {
    const p = basic[id];
    if (!p) { fail(`basic.${id} is not defined in the manifest.`); continue; }
    const abs = resolveAsset(p);
    if (!fs.existsSync(abs)) fail(`basic.${id} -> ${p} : file not found (${path.relative(publicDir, abs)}).`);
    else ok(`basic.${id} -> ${p}`);
  }

  // 5. premium entries: warn-only / info.
  let provided = 0, missing = 0, reserved = 0;
  for (const [id, p] of Object.entries(premium)) {
    if (p == null) { reserved++; continue; }
    const abs = resolveAsset(p);
    if (fs.existsSync(abs)) { provided++; ok(`premium.${id} -> ${p} (provided)`); }
    else { missing++; warn(`premium.${id} -> ${p} : not present yet (placeholder fallback at runtime).`); }
  }
  console.log(`  premium summary: ${provided} provided, ${missing} declared-but-missing (warn), ${reserved} reserved (null).`);
}

if (failed) {
  console.error('[check:props] ✗ FAIL: prop asset registry has blocking problems (see above).');
  process.exit(1);
}
console.log('[check:props] ✓ OK: basic props present, ledger present, manifest valid. Premium pending is fine.');
process.exit(0);
