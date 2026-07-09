// Prop Variants 0.8 — per-slot model alternatives, selectable from the panel.
//
// public/models/props/props.variants.json describes, for each scene prop slot
// (matched by SceneProp.id — desk / chair / laptop), the model variants the
// user can swap in at runtime. Contract (mirrors the registry's _about note):
//   * a chosen variant REPLACES the prop's url / scale / rotation
//   * its `offset` is ADDED to the scene.json position (offsets are baked
//     bottom-center normalizations measured from glTF accessor min/max)
//   * the 'basic' variant (no url) leaves the scene.json prop untouched
//   * a missing/unknown registry, slot, or variant id is always a safe no-op —
//     scene.json remains authoritative (app must never crash on bad data)
// Selection persists per browser in localStorage. NO THREE import and no DOM
// dependency outside the storage helpers (Node-testable, like sceneLoader).

import type { ScenePreset, SceneProp, Vec3 } from './sceneTypes';
import { publicAssetUrl } from '../assetUrl';

export interface PropVariant {
  id: string;
  label: string;
  url?: string; // absent => 'basic' (use the scene.json prop as-is)
  scale?: number;
  offset?: Vec3;
  rotation?: Vec3;
  // License bookkeeping (surfaced in the UI; ledger lives in ASSET_CREDITS.md).
  author?: string;
  license?: string;
  source?: string;
  attribution?: string; // CC-BY display string, shown verbatim in the panel
}

export interface PropVariantSlot {
  label: string;
  variants: PropVariant[];
  // Variant id selected for a fresh browser (no stored choice). Lets the app
  // ship a curated default set without changing scene.json's 'basic' models.
  default?: string;
}

export interface PropVariantsRegistry {
  version: number;
  slots: Record<string, PropVariantSlot>;
}

// slot id -> selected variant id. Slots absent from the map mean 'basic'.
export type VariantSelection = Record<string, string>;

export const BASIC_VARIANT_ID = 'basic';
export const VARIANT_SELECTION_STORAGE_KEY = 'props.variantSelection.v1';
const REGISTRY_URL = '/models/props/props.variants.json';

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const asVec3 = (v: unknown): Vec3 | undefined =>
  Array.isArray(v) && v.length === 3 && v.every(isNum) ? [v[0] as number, v[1] as number, v[2] as number] : undefined;

// Validate + normalize a raw parsed registry. Returns null when the input is
// unusable; individually broken variants/slots are dropped, never fatal.
export function validateVariantsRegistry(raw: unknown): PropVariantsRegistry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!r.slots || typeof r.slots !== 'object') return null;
  const slots: Record<string, PropVariantSlot> = {};
  for (const [slotId, rawSlot] of Object.entries(r.slots as Record<string, unknown>)) {
    if (!rawSlot || typeof rawSlot !== 'object') continue;
    const s = rawSlot as Record<string, unknown>;
    const rawVariants = Array.isArray(s.variants) ? s.variants : [];
    const variants: PropVariant[] = [];
    for (const rawV of rawVariants) {
      if (!rawV || typeof rawV !== 'object') continue;
      const v = rawV as Record<string, unknown>;
      if (!isStr(v.id) || !v.id) continue;
      variants.push({
        id: v.id,
        label: isStr(v.label) ? v.label : v.id,
        url: isStr(v.url) ? v.url : undefined,
        scale: isNum(v.scale) ? v.scale : undefined,
        offset: asVec3(v.offset),
        rotation: asVec3(v.rotation),
        author: isStr(v.author) ? v.author : undefined,
        license: isStr(v.license) ? v.license : undefined,
        source: isStr(v.source) ? v.source : undefined,
        attribution: isStr(v.attribution) ? v.attribution : undefined,
      });
    }
    if (variants.length > 0) {
      slots[slotId] = {
        label: isStr(s.label) ? s.label : slotId,
        variants,
        default: isStr(s.default) ? s.default : undefined,
      };
    }
  }
  if (Object.keys(slots).length === 0) return null;
  return { version: isNum(r.version) ? r.version : 1, slots };
}

// Fetch + validate the registry. Resolves (never rejects); null = no registry
// (file absent/malformed) and the variant system simply stays inert.
export async function loadPropVariantsRegistry(): Promise<PropVariantsRegistry | null> {
  try {
    const res = await fetch(publicAssetUrl(REGISTRY_URL));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const registry = validateVariantsRegistry((await res.json()) as unknown);
    if (!registry) console.warn('[VARIANTS] props.variants.json is malformed — variant UI disabled');
    return registry;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[VARIANTS] registry load failed (${msg}) — variant UI disabled`);
    return null;
  }
}

// Look up the selected variant for one slot (null = basic / not found).
export function getSelectedVariant(
  registry: PropVariantsRegistry | null,
  selection: VariantSelection,
  slotId: string,
): PropVariant | null {
  const id = selection[slotId];
  if (!registry || !id || id === BASIC_VARIANT_ID) return null;
  const variant = registry.slots[slotId]?.variants.find((v) => v.id === id);
  return variant && variant.url ? variant : null;
}

// Apply the selected variants to a (validated) scene preset. Returns a NEW
// preset — props with an active variant get url/scale/rotation replaced and
// offset added to position; everything else is passed through untouched.
export function applyVariantsToScene(
  scene: ScenePreset,
  registry: PropVariantsRegistry | null,
  selection: VariantSelection,
): ScenePreset {
  if (!registry) return scene;
  let changed = false;
  const props: SceneProp[] = scene.props.map((prop) => {
    const variant = getSelectedVariant(registry, selection, prop.id);
    if (!variant || !variant.url) return prop;
    changed = true;
    const off: Vec3 = variant.offset ?? [0, 0, 0];
    return {
      ...prop,
      url: variant.url,
      label: `${prop.label ?? prop.id} → ${variant.label}`,
      scale: variant.scale ?? prop.scale,
      rotation: variant.rotation ?? prop.rotation,
      position: [prop.position[0] + off[0], prop.position[1] + off[1], prop.position[2] + off[2]],
    };
  });
  return changed ? { ...scene, props } : scene;
}

// --- Selection persistence (browser only; guarded for headless tests) --------

export function loadVariantSelection(): VariantSelection {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = JSON.parse(localStorage.getItem(VARIANT_SELECTION_STORAGE_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: VariantSelection = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (isStr(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveVariantSelection(selection: VariantSelection): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(VARIANT_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    /* private mode etc. — non-fatal */
  }
}
