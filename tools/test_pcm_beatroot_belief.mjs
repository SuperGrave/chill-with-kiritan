import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const overlay = path.join(root, '02_ui-overlay');
const outDir = path.join(root, '.probe_tmp', 'pcm_beatroot_belief_build');
rmSync(outDir, { recursive: true, force: true });
execSync(
  `npx tsc src/lib/tempoBelief.ts --ignoreConfig --outDir "${outDir}" --module commonjs --target es2022 --moduleResolution node --ignoreDeprecations 6.0 --skipLibCheck`,
  { cwd: overlay, stdio: 'inherit' },
);

const { TempoBelief } = require(path.join(outDir, 'tempoBelief.js'));
const config = { stableMs: 5_000, confidenceThreshold: 0.7, changeConfirmMs: 9_000 };
const belief = new TempoBelief();
let passed = 0;

function ok(condition, label) {
  if (!condition) throw new Error(label);
  passed++;
  console.log(`  ✓ ${label}`);
}

ok(belief.apply(120, 0.82, 0, config).lockedBpm === null, 'first estimate remains a candidate');
ok(belief.apply(121, 0.76, 3_000, config).lockedBpm === null, 'candidate waits for configured stability');
ok(belief.apply(120, 0.9, 6_000, config).lockedBpm === 120, 'stable high-confidence estimates lock');

const weak = belief.apply(91, 0.69, 9_000, config);
ok(!weak.accepted && weak.lockedBpm === null && weak.retainedBpm === 120, 'under-70% estimate is not emitted but history survives');

const transient = belief.apply(91, 0.88, 12_000, config);
ok(transient.lockedBpm === 120 && transient.challengerBpm === 91, 'one distant estimate cannot replace the retained tempo');
const recovered = belief.apply(121, 0.86, 15_000, config);
ok(recovered.lockedBpm === 120 && recovered.challengerBpm === null, 'returning to the retained range clears the challenger');
ok(belief.apply(60, 0.9, 18_000, config).lockedBpm === 120, 'temporary half-tempo reading folds to the retained family');

belief.apply(90, 0.9, 20_000, config);
belief.apply(91, 0.9, 25_000, config);
ok(belief.apply(90, 0.9, 30_000, config).lockedBpm === 90, 'coherent challenger replaces tempo after confirmation time');

belief.reset();
const reset = belief.apply(90, 0.9, 31_000, config);
ok(reset.retainedBpm === null && reset.lockedBpm === null, 'reset clears every retained statistic');

console.log(`\n${passed} PCM BeatRoot belief checks passed.`);
