// Read-only diagnostic: enumerate the VRM 0.x blendShapeMaster groups and the
// raw morph-target names of the face mesh, so expression presets can be
// designed against the model's REAL inventory (no model modification).
import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? new URL('../01_wallpaper/public/models/kiritan.vrm', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const buf = readFileSync(path);

// GLB container: 12-byte header, then chunks (length, type, data).
const magic = buf.readUInt32LE(0);
if (magic !== 0x46546c67) throw new Error('not a GLB file');
let offset = 12;
let json = null;
while (offset < buf.length) {
  const chunkLen = buf.readUInt32LE(offset);
  const chunkType = buf.readUInt32LE(offset + 4);
  if (chunkType === 0x4e4f534a) {
    json = JSON.parse(buf.subarray(offset + 8, offset + 8 + chunkLen).toString('utf8'));
    break;
  }
  offset += 8 + chunkLen;
}
if (!json) throw new Error('no JSON chunk');

const vrm = json.extensions?.VRM;
const groups = vrm?.blendShapeMaster?.blendShapeGroups ?? [];
console.log('=== blendShapeGroups (' + groups.length + ') ===');
for (const g of groups) {
  const binds = (g.binds ?? []).map((b) => `mesh${b.mesh}#${b.index}@${(b.weight ?? 100)}`).join(', ');
  console.log(`presetName="${g.presetName}" name="${g.name}" binds=[${binds}] materialValues=${(g.materialValues ?? []).length}`);
}

// Morph target names per mesh (from extras.targetNames or primitive extras).
console.log('\n=== meshes with morph targets ===');
(json.meshes ?? []).forEach((m, mi) => {
  const prim = m.primitives?.[0];
  const names = m.extras?.targetNames ?? prim?.extras?.targetNames;
  const count = prim?.targets?.length ?? 0;
  if (count > 0) {
    console.log(`mesh ${mi} "${m.name}": ${count} targets`);
    if (names) names.forEach((n, i) => console.log(`  [${i}] ${n}`));
    else console.log('  (no targetNames extras)');
  }
});
