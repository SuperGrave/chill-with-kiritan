// Scene Layout Calibration Probe 0.6 (Motion Probe 0.6) — visual guides.
//
// Toggleable scaffolding (T) that makes 3D placement legible while calibrating:
//   * world grid      — floor reference at y=0
//   * axes helper     — world origin X/Y/Z
//   * prop / character bounding boxes — follow the live objects (BoxHelper.update)
//   * camera target marker — small sphere at the current look target
//   * desk surface plane   — thin marker at the desk box's top, so the laptop can
//                            be sat "on" it and the desk edge depth is readable
//
// The selected target's box is highlighted. Everything lives under a single group
// added to the scene; setVisible() flips the whole group. THREE-only (no React);
// the per-frame update() is driven from the VrmViewer render loop, guarded by the
// guidesEnabled toggle so there is zero cost when guides are off.

import * as THREE from 'three';
import type { LayoutTargetId, PropTargetId } from './layoutCalibration';

// Base wire colors per target; the selected target is recolored on top.
const BASE_COLOR: Record<PropTargetId, number> = {
  character: 0x44dd88,
  desk: 0xff8844,
  chair: 0x4488ff,
  laptop: 0xdddddd,
};
const SELECTED_COLOR = 0xffe24a;

export interface LayoutGuides {
  group: THREE.Group;
  setVisible(on: boolean): void;
  setSelected(id: LayoutTargetId): void;
  // (Re)bind the tracked objects (call after each scene (re)load — prop containers
  // are recreated). A null/absent entry removes that box.
  setTracked(objs: Partial<Record<PropTargetId, THREE.Object3D | null>>): void;
  // Per-frame refresh of boxes + markers. `targetWorld` is the camera look target.
  update(targetWorld: THREE.Vector3): void;
  dispose(): void;
}

export function createLayoutGuides(): LayoutGuides {
  const group = new THREE.Group();
  group.name = 'layoutGuides';
  group.visible = false;

  // World grid on the floor (y=0) + origin axes.
  const grid = new THREE.GridHelper(4, 16, 0x66aaff, 0x2b3a4a);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.5;
  group.add(grid);

  const axes = new THREE.AxesHelper(0.8);
  group.add(axes);

  // Camera look-target marker.
  const targetMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff33aa, depthTest: false }),
  );
  targetMarker.renderOrder = 999;
  group.add(targetMarker);

  // Desk surface plane marker (horizontal), repositioned each frame from the
  // desk bounding box top. Hidden until a desk is tracked.
  const deskPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      color: 0xff8844,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
    }),
  );
  deskPlane.rotation.x = -Math.PI / 2; // lay flat (XZ)
  deskPlane.visible = false;
  group.add(deskPlane);

  // BoxHelpers for the tracked objects, created on demand in setTracked.
  const boxes: Partial<Record<PropTargetId, THREE.BoxHelper>> = {};
  const tracked: Partial<Record<PropTargetId, THREE.Object3D | null>> = {};
  let selected: LayoutTargetId = 'character';

  const _box3 = new THREE.Box3();
  const _size = new THREE.Vector3();
  const _center = new THREE.Vector3();

  const colorFor = (id: PropTargetId): number =>
    selected === id ? SELECTED_COLOR : BASE_COLOR[id];

  function removeBox(id: PropTargetId) {
    const h = boxes[id];
    if (h) {
      group.remove(h);
      h.geometry.dispose();
      (h.material as THREE.Material).dispose();
      delete boxes[id];
    }
  }

  function setTracked(objs: Partial<Record<PropTargetId, THREE.Object3D | null>>) {
    for (const key of Object.keys(objs) as PropTargetId[]) {
      const obj = objs[key] ?? null;
      tracked[key] = obj;
      removeBox(key);
      if (obj) {
        const helper = new THREE.BoxHelper(obj, colorFor(key));
        helper.name = `bbox:${key}`;
        boxes[key] = helper;
        group.add(helper);
      }
    }
  }

  function setSelected(id: LayoutTargetId) {
    selected = id;
    for (const key of Object.keys(boxes) as PropTargetId[]) {
      const h = boxes[key];
      if (h) (h.material as THREE.LineBasicMaterial).color.setHex(colorFor(key));
    }
  }

  function update(targetWorld: THREE.Vector3) {
    if (!group.visible) return;
    for (const key of Object.keys(boxes) as PropTargetId[]) {
      const h = boxes[key];
      const obj = tracked[key];
      if (h && obj) h.update();
    }
    targetMarker.position.copy(targetWorld);

    const desk = tracked.desk;
    if (desk) {
      _box3.setFromObject(desk);
      if (!_box3.isEmpty()) {
        _box3.getSize(_size);
        _box3.getCenter(_center);
        deskPlane.visible = true;
        deskPlane.position.set(_center.x, _box3.max.y + 0.001, _center.z);
        deskPlane.scale.set(_size.x, _size.z, 1); // plane is XY then rotated to XZ
      } else {
        deskPlane.visible = false;
      }
    } else {
      deskPlane.visible = false;
    }
  }

  function setVisible(on: boolean) {
    group.visible = on;
  }

  function dispose() {
    for (const key of Object.keys(boxes) as PropTargetId[]) removeBox(key);
    grid.geometry.dispose();
    (grid.material as THREE.Material).dispose();
    axes.dispose();
    targetMarker.geometry.dispose();
    (targetMarker.material as THREE.Material).dispose();
    deskPlane.geometry.dispose();
    (deskPlane.material as THREE.Material).dispose();
  }

  return { group, setVisible, setSelected, setTracked, update, dispose };
}
