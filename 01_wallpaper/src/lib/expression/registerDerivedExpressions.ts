// Derived-expression registration (Expression Preset System 0.1)
//
// Promotes the curated raw face morphs (DERIVED_EXPRESSIONS) to named entries
// in the Custom Expression Bridge's runtime map, resolving indices BY NAME
// from the meshes' morphTargetDictionary (built by mesh.updateMorphTargets()
// from the glTF targetNames — i.e. the model's own authored names).
//
// Strictly additive and strictly honest:
//   * existing entries (from blendShapeMaster) are never overwritten,
//   * a morph name the model doesn't have is reported in `missing` and the
//     derived expression is simply not registered (no fabrication),
//   * the model file itself is never touched.
//
// Structural typing (no THREE import) keeps the expression lib Node-testable.

import { DERIVED_EXPRESSIONS } from './expressionPresets';

export interface MorphDictionaryMesh {
  morphTargetDictionary?: Record<string, number>;
}

export interface ExpressionBind {
  index: number;
  weight: number;
}

export interface DerivedRegistrationReport {
  /** Derived ids actually registered this call. */
  registered: string[];
  /** Derived ids skipped because the model lacks the morph name(s). */
  missing: { id: string; morphNames: string[] }[];
  /** Derived ids skipped because the bridge map already had the name. */
  skipped: string[];
}

/**
 * Build a morph name -> index map from the glTF JSON the model was loaded
 * from. UniVRM-exported VRM 0.x stores targetNames on the PRIMITIVE extras,
 * which three's GLTFLoader ignores (it only reads mesh-level extras), so the
 * runtime morphTargetDictionary ends up with numeric keys — the JSON is the
 * reliable source for the authored names. First occurrence wins (this model
 * has exactly one morph-carrying primitive).
 */
export function buildMorphNameIndex(gltfJson: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const meshes = (gltfJson as { meshes?: { extras?: { targetNames?: unknown }; primitives?: { extras?: { targetNames?: unknown } }[] }[] })
    ?.meshes ?? [];
  for (const mesh of meshes) {
    const candidates = [mesh.extras?.targetNames, ...(mesh.primitives ?? []).map((p) => p.extras?.targetNames)];
    for (const names of candidates) {
      if (!Array.isArray(names)) continue;
      names.forEach((n, i) => {
        if (typeof n === 'string' && !(n in out)) out[n] = i;
      });
    }
  }
  return out;
}

/**
 * Register every resolvable derived expression into `expressionMap` (the
 * bridge's name -> binds table). Mutates the map in place and returns a
 * report for the console / debug UI. Resolution order: the live meshes'
 * morphTargetDictionary, then the glTF-JSON name table (see above).
 */
export function registerDerivedExpressions(
  expressionMap: Record<string, ExpressionBind[]>,
  faceMeshes: readonly MorphDictionaryMesh[],
  morphNameIndex?: Record<string, number>,
): DerivedRegistrationReport {
  const report: DerivedRegistrationReport = { registered: [], missing: [], skipped: [] };

  const resolveIndex = (morphName: string): number | null => {
    for (const mesh of faceMeshes) {
      const idx = mesh.morphTargetDictionary?.[morphName];
      if (idx !== undefined) return idx;
    }
    return morphNameIndex?.[morphName] ?? null;
  };

  for (const def of DERIVED_EXPRESSIONS) {
    const id = def.id.toLowerCase();
    if (expressionMap[id]) {
      report.skipped.push(id);
      continue;
    }
    const binds: ExpressionBind[] = [];
    const unresolved: string[] = [];
    for (const m of def.morphs) {
      const index = resolveIndex(m.name);
      if (index === null) unresolved.push(m.name);
      else binds.push({ index, weight: m.weight ?? 1 });
    }
    if (unresolved.length > 0 || binds.length === 0) {
      report.missing.push({ id, morphNames: unresolved });
      continue;
    }
    expressionMap[id] = binds;
    report.registered.push(id);
  }
  return report;
}
