// Scene / Props Probe 0.1 (Motion Probe 0.4) — scene.json loader + validator.
//
// Role (per brief §2):
//   * fetch public/scenes/<id>/scene.json
//   * lightly validate / normalize the shape (never trust the JSON blindly)
//   * on any failure, return the built-in default scene (app must not crash)
//   * surface status + warnings to the caller
//
// validateScenePreset() is a PURE function (no THREE, no fetch) so it is
// unit-tested headless in Node (see .probe_tmp/test_scene_loader.mjs and memory:
// verify-webgl-probe-via-node). loadScenePreset() wraps it around fetch and
// can never reject — failures resolve to { usedDefault: true }.

import type { ScenePreset, SceneProp, SceneLoadResult, SceneLighting, Vec3, PropFallback } from './sceneTypes';
import { buildDefaultScene, DEFAULT_SCENE_ID } from './scenePresets';

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function coerceVec3(v: unknown, fallback: Vec3, label: string, warnings: string[]): Vec3 {
  if (Array.isArray(v) && v.length === 3 && v.every(isNum)) return [v[0] as number, v[1] as number, v[2] as number];
  if (v !== undefined) warnings.push(`${label}: expected [x,y,z] numbers — using ${JSON.stringify(fallback)}`);
  return fallback;
}

function coerceScale(v: unknown, label: string, warnings: string[]): number | Vec3 {
  if (isNum(v)) return v;
  if (Array.isArray(v) && v.length === 3 && v.every(isNum)) return [v[0] as number, v[1] as number, v[2] as number];
  if (v !== undefined) warnings.push(`${label}: invalid scale — using 1`);
  return 1;
}

function coerceProp(raw: unknown, i: number, warnings: string[]): SceneProp | null {
  if (!raw || typeof raw !== 'object') {
    warnings.push(`props[${i}]: not an object — skipped`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  const id = isStr(r.id) ? r.id : '';
  if (!id) {
    warnings.push(`props[${i}]: missing "id" — skipped`);
    return null;
  }
  const url = isStr(r.url) ? r.url : '';
  if (!url) warnings.push(`prop "${id}": missing "url" — will use placeholder/none`);
  const fallback: PropFallback = r.fallback === 'none' ? 'none' : 'box';
  return {
    id,
    label: isStr(r.label) ? r.label : id,
    type: 'glb',
    url,
    fallback,
    position: coerceVec3(r.position, [0, 0, 0], `prop "${id}".position`, warnings),
    rotation: coerceVec3(r.rotation, [0, 0, 0], `prop "${id}".rotation`, warnings),
    scale: coerceScale(r.scale, `prop "${id}".scale`, warnings),
    visible: r.visible === false ? false : true,
    placeholderColor: isStr(r.placeholderColor) ? r.placeholderColor : undefined,
  };
}

function coerceLighting(v: unknown): SceneLighting | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const l = v as Record<string, unknown>;
  return {
    ambientStrength: isNum(l.ambientStrength) ? l.ambientStrength : 1.0,
    mainLightColor: isStr(l.mainLightColor) ? l.mainLightColor : '#ffffff',
    mainLightStrength: isNum(l.mainLightStrength) ? l.mainLightStrength : 1.0,
  };
}

// Validate + normalize a raw parsed scene.json into a ScenePreset. Never throws;
// anything missing/invalid is defaulted and a warning is recorded. A totally
// unusable input yields the built-in default scene.
export function validateScenePreset(raw: unknown, fallbackId: string = DEFAULT_SCENE_ID): { scene: ScenePreset; warnings: string[] } {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object') {
    warnings.push('scene.json is not an object — using built-in default');
    return { scene: buildDefaultScene(fallbackId), warnings };
  }
  const r = raw as Record<string, unknown>;

  const sceneId = isStr(r.sceneId) ? r.sceneId : fallbackId;
  if (!isStr(r.sceneId)) warnings.push(`missing "sceneId" — using "${fallbackId}"`);
  const label = isStr(r.label) ? r.label : sceneId;

  const rawProps = Array.isArray(r.props) ? r.props : [];
  if (!Array.isArray(r.props)) warnings.push('"props" is not an array — no props loaded');
  const props: SceneProp[] = [];
  rawProps.forEach((p, i) => {
    const cp = coerceProp(p, i, warnings);
    if (cp) props.push(cp);
  });

  const scene: ScenePreset = {
    sceneId,
    label,
    props,
    // background / camera / character are receivers this phase: carried through
    // loosely (objects passed as-is) so scene.json can grow without code churn.
    background: r.background && typeof r.background === 'object' ? (r.background as ScenePreset['background']) : undefined,
    character: r.character && typeof r.character === 'object' ? (r.character as ScenePreset['character']) : undefined,
    camera: r.camera && typeof r.camera === 'object' ? (r.camera as ScenePreset['camera']) : undefined,
    lighting: coerceLighting(r.lighting),
  };
  return { scene, warnings };
}

// Fetch + validate a scene preset by id. Resolves (never rejects): on any
// fetch/parse error it returns the built-in default scene with usedDefault=true.
export async function loadScenePreset(sceneId: string): Promise<{ scene: ScenePreset; result: SceneLoadResult }> {
  const url = `/scenes/${sceneId}/scene.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: unknown = await res.json();
    const { scene, warnings } = validateScenePreset(json, sceneId);
    return {
      scene,
      result: { sceneId: scene.sceneId, ok: true, usedDefault: false, warnings, source: 'fetched' },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      scene: buildDefaultScene(sceneId),
      result: {
        sceneId,
        ok: false,
        usedDefault: true,
        warnings: [`scene.json load failed (${msg}) — using built-in default scene`],
        source: 'default',
      },
    };
  }
}
