// Stage D (2026-07-01) — daypart.ts verification harness.
//
// Usage:  node tools/test_daypart.mjs
//
// daypart.ts is a plain pure function (no THREE/DOM), so this compiles it to
// CommonJS the same way tools/test_pose_undo.mjs does for THREE-free modules
// and asserts the day/night boundary + override precedence.

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = path.join(root, '01_wallpaper');
const outDir = path.join(root, '.probe_tmp', 'daypart_build');

rmSync(outDir, { recursive: true, force: true });
execSync(
  `npx tsc src/lib/scene/daypart.ts --ignoreConfig --outDir "${outDir}" ` +
    `--module commonjs --target es2022 --moduleResolution node --ignoreDeprecations 6.0 --skipLibCheck`,
  { cwd: pkg, stdio: 'inherit' },
);

const { getDaypart, resolveDaypart, DAY_START_HOUR, DAY_END_HOUR } = require(path.join(outDir, 'daypart.js'));

let pass = 0;
let fail = 0;
const failures = [];
function ok(cond, label) {
  if (cond) pass++;
  else {
    fail++;
    failures.push(label);
    console.error(`  ✗ FAIL: ${label}`);
  }
}
function section(t) {
  console.log(`\n=== ${t} ===`);
}

const at = (h, m = 0) => new Date(2026, 6, 1, h, m, 0);

section('1. getDaypart — boundary hours');
{
  ok(getDaypart(at(0)) === 'night', 'midnight is night');
  ok(getDaypart(at(5, 59)) === 'night', '05:59 is night');
  ok(getDaypart(at(DAY_START_HOUR, 0)) === 'day', `${DAY_START_HOUR}:00 is day (start inclusive)`);
  ok(getDaypart(at(12)) === 'day', 'noon is day');
  ok(getDaypart(at(DAY_END_HOUR - 1, 59)) === 'day', `${DAY_END_HOUR - 1}:59 is day`);
  ok(getDaypart(at(DAY_END_HOUR, 0)) === 'night', `${DAY_END_HOUR}:00 is night (end exclusive)`);
  ok(getDaypart(at(23, 59)) === 'night', '23:59 is night');
}

section('2. getDaypart — every hour is exactly one or the other');
{
  let dayCount = 0;
  let nightCount = 0;
  for (let h = 0; h < 24; h++) {
    const d = getDaypart(at(h));
    ok(d === 'day' || d === 'night', `hour ${h} resolves to a valid Daypart (got ${d})`);
    if (d === 'day') dayCount++;
    else nightCount++;
  }
  ok(dayCount === DAY_END_HOUR - DAY_START_HOUR, `day hours count matches the window (${dayCount})`);
  ok(nightCount === 24 - (DAY_END_HOUR - DAY_START_HOUR), `night hours count matches (${nightCount})`);
}

section('3. resolveDaypart — override precedence');
{
  ok(resolveDaypart('day', at(23)) === 'day', "override 'day' wins over a night clock");
  ok(resolveDaypart('night', at(12)) === 'night', "override 'night' wins over a day clock");
  ok(resolveDaypart('auto', at(12)) === 'day', "'auto' falls back to the clock (day)");
  ok(resolveDaypart('auto', at(23)) === 'night', "'auto' falls back to the clock (night)");
  ok(resolveDaypart(undefined, at(12)) === 'day', 'undefined falls back to the clock (day)');
  ok(resolveDaypart(undefined, at(23)) === 'night', 'undefined falls back to the clock (night)');
}

console.log(`\n${'='.repeat(60)}`);
console.log(`Daypart: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('FAILURES:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('ALL PASS — day/night boundary + override precedence verified.');
