// Prop Library 0.9 — small "motion-use" desk items (cup / phone / controller /
// book / headphones / snack_plate), keyed by the Motion Director's PropId.
//
// public/models/props/props.library.json registers each item with a baked
// real-world scale and a desk REST transform (bottom sitting on the desk top,
// horizontally centered on its `anchor` slot). This module:
//   * loads + validates that registry (resolves to null when absent/malformed)
//   * turns the ENABLED items into ordinary SceneProps appended to the scene at
//     load time — so they reuse the whole propLoader path (placeholder box on a
//     missing GLB, the Props/Placeholders toggles, disposal, the debug report)
//   * persists per-item visibility in localStorage
// The semantic `anchor` (desk_left/center/right) is carried for the future
// Motion Director attach/detach mechanism (Phase 2); for now items only rest.
// NO THREE import and no DOM outside the storage helpers (Node-testable, like
// sceneLoader / propVariants).

import type { SceneProp, Vec3 } from './sceneTypes';
import type { TransformEntry } from './layoutCalibration';

export type PropAnchorSlot = 'desk_left' | 'desk_center' | 'desk_right';

/** Bone-local grip transform for a held prop (INF-4). Mirrors propAttach.GripOffset. */
export interface PropGrip {
  position: Vec3;
  rotation: Vec3; // euler XYZ radians, in the target bone's local space
  scale?: number; // optional local scale override (omit when the bone is unit-scaled)
}

/** Per-anchor attach offsets the Motion Director uses for hand/head props (INF-4). */
export interface PropAttachOffsets {
  hand_r?: PropGrip;
  hand_l?: PropGrip;
  head?: PropGrip;
}

export interface PropLibraryItem {
  id: string; // matches Director PropId (cup/phone/controller/book/headphones/snack_plate)
  label: string;
  url: string;
  scale: number;
  position: Vec3; // baked rest world position (bottom on the desk top)
  rotation: Vec3;
  anchor: PropAnchorSlot;
  defaultOn?: boolean; // shown when the user has no stored preference
  author?: string;
  license?: string;
  source?: string;
  attribution?: string; // CC-BY display string, shown verbatim in the panel
  placeholderColor?: string;
  /** Hand/head grip offsets for the Motion Director's attach/detach (INF-4). */
  attach?: PropAttachOffsets;
}

export interface PropLibrary {
  version: number;
  items: PropLibraryItem[];
}

// id -> visible. Items absent from the map fall back to their `defaultOn`.
export type ItemSelection = Record<string, boolean>;

export const ITEM_SELECTION_STORAGE_KEY = 'props.itemSelection.v1';
const LIBRARY_URL = '/models/props/props.library.json';

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const asVec3 = (v: unknown): Vec3 | undefined =>
  Array.isArray(v) && v.length === 3 && v.every(isNum) ? [v[0] as number, v[1] as number, v[2] as number] : undefined;
const isAnchor = (v: unknown): v is PropAnchorSlot => v === 'desk_left' || v === 'desk_center' || v === 'desk_right';

const asGrip = (v: unknown): PropGrip | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const g = v as Record<string, unknown>;
  const position = asVec3(g.position);
  const rotation = asVec3(g.rotation);
  if (!position || !rotation) return undefined;
  return { position, rotation, ...(isNum(g.scale) ? { scale: g.scale } : {}) };
};
const asAttach = (v: unknown): PropAttachOffsets | undefined => {
  if (!v || typeof v !== 'object') return undefined;
  const a = v as Record<string, unknown>;
  const out: PropAttachOffsets = {};
  const hr = asGrip(a.hand_r);
  const hl = asGrip(a.hand_l);
  const hd = asGrip(a.head);
  if (hr) out.hand_r = hr;
  if (hl) out.hand_l = hl;
  if (hd) out.head = hd;
  return Object.keys(out).length ? out : undefined;
};

// Validate + normalize a raw parsed library. Returns null when unusable;
// individually broken items are dropped, never fatal.
export function validatePropLibrary(raw: unknown): PropLibrary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const rawItems = Array.isArray(r.items) ? r.items : [];
  const items: PropLibraryItem[] = [];
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const it = rawItem as Record<string, unknown>;
    const id = isStr(it.id) ? it.id : '';
    const url = isStr(it.url) ? it.url : '';
    const position = asVec3(it.position);
    if (!id || !url || !position) continue; // these three are mandatory
    items.push({
      id,
      label: isStr(it.label) ? it.label : id,
      url,
      scale: isNum(it.scale) ? it.scale : 1,
      position,
      rotation: asVec3(it.rotation) ?? [0, 0, 0],
      anchor: isAnchor(it.anchor) ? it.anchor : 'desk_center',
      defaultOn: it.defaultOn === true,
      author: isStr(it.author) ? it.author : undefined,
      license: isStr(it.license) ? it.license : undefined,
      source: isStr(it.source) ? it.source : undefined,
      attribution: isStr(it.attribution) ? it.attribution : undefined,
      placeholderColor: isStr(it.placeholderColor) ? it.placeholderColor : undefined,
      attach: asAttach(it.attach),
    });
  }
  if (items.length === 0) return null;
  return { version: isNum(r.version) ? r.version : 1, items };
}

// Fetch + validate the library. Resolves (never rejects); null = no library.
export async function loadPropLibrary(): Promise<PropLibrary | null> {
  try {
    const res = await fetch(LIBRARY_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const library = validatePropLibrary((await res.json()) as unknown);
    if (!library) console.warn('[ITEMS] props.library.json is malformed — small-prop UI disabled');
    return library;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ITEMS] library load failed (${msg}) — small-prop UI disabled`);
    return null;
  }
}

// Whether an item is currently visible (explicit choice wins, else its default).
export function isItemEnabled(item: PropLibraryItem, selection: ItemSelection): boolean {
  return selection[item.id] ?? item.defaultOn === true;
}

// Per-item placement override (Prop Layout 1.0). Same shape as the layout
// calibration's TransformEntry. Keyed by the FULL scene-prop id (`item:<id>`),
// matching the live `itemLayout` map the viewer applies each frame, so a single
// source feeds both the initial SceneProp and the per-frame transform.
export type ItemTransforms = Record<string, TransformEntry>;

export const ITEM_TRANSFORMS_STORAGE_KEY = 'props.itemTransforms.v1';

// The item's baked desk REST transform from the registry, as a TransformEntry
// (the library stores scale as one number; expand it to xyz). This is the value
// the calibration starts from before the user nudges it.
export function itemRestTransform(item: PropLibraryItem): TransformEntry {
  return {
    position: [item.position[0], item.position[1], item.position[2]],
    rotation: [item.rotation[0], item.rotation[1], item.rotation[2]],
    scale: [item.scale, item.scale, item.scale],
  };
}

// The enabled library items as ordinary SceneProps, ready to append to a scene's
// `props`. Each id is prefixed `item:` so it can never collide with a scene's own
// desk/chair/laptop ids. `overrides` (keyed by `item:<id>`) lets the user's saved
// placement seed the initial transform; absent entries fall back to the REST pose.
export function libraryItemsToSceneProps(
  library: PropLibrary | null,
  selection: ItemSelection,
  overrides: ItemTransforms = {},
): SceneProp[] {
  if (!library) return [];
  return library.items
    .filter((it) => isItemEnabled(it, selection))
    .map((it) => {
      const o = overrides[`item:${it.id}`];
      return {
        id: `item:${it.id}`,
        label: it.label,
        type: 'glb' as const,
        url: it.url,
        fallback: 'box' as const,
        position: o ? o.position : it.position,
        rotation: o ? o.rotation : it.rotation,
        scale: o ? o.scale : it.scale,
        visible: true,
        placeholderColor: it.placeholderColor ?? '#9a8c98',
      };
    });
}

// --- Selection persistence (browser only; guarded for headless tests) --------

export function loadItemSelection(): ItemSelection {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = JSON.parse(localStorage.getItem(ITEM_SELECTION_STORAGE_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: ItemSelection = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveItemSelection(selection: ItemSelection): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ITEM_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch {
    /* private mode etc. — non-fatal */
  }
}

// Per-item placement overrides (Prop Layout 1.0). Only items the user actually
// moved are stored; everything else stays at its registry REST pose. Malformed
// entries are dropped, never fatal (same contract as loadItemSelection).
export function loadItemTransforms(): ItemTransforms {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = JSON.parse(localStorage.getItem(ITEM_TRANSFORMS_STORAGE_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: ItemTransforms = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const e = v as Record<string, unknown>;
      const position = asVec3(e.position);
      const rotation = asVec3(e.rotation);
      const scale = asVec3(e.scale);
      if (position && rotation && scale) out[k] = { position, rotation, scale };
    }
    return out;
  } catch {
    return {};
  }
}

export function saveItemTransforms(transforms: ItemTransforms): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ITEM_TRANSFORMS_STORAGE_KEY, JSON.stringify(transforms));
  } catch {
    /* private mode etc. — non-fatal */
  }
}
