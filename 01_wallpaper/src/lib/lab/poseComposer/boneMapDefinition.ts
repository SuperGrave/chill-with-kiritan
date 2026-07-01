// Pose Composer 0.8 — humanoid bone map (Stage 2)
//
// Static front/side layout for the SVG body map (指示書 §6.3 / §10.2). MVP keeps
// the coordinates hand-authored (the dynamic project-from-real-VRM version is a
// later phase, §25 1.1). Coordinates live in a 120x240 portrait viewBox.
//
// Orientation matches the on-screen render: the character FACES the camera, so
// her left-side bones appear on the VIEWER's right (x > 60). Finger bones are
// intentionally excluded here — they get the dedicated Hand Shape panel (Stage 6).

export type BoneMapGroup = 'torso' | 'arm' | 'leg' | 'head';

export interface BoneMapNode {
  /** HumanoidBoneName. */
  bone: string;
  /** Japanese label for the inspector / tooltip. */
  label: string;
  /** Front-view marker position (viewer looking at her). */
  front: { x: number; y: number };
  /** Side-view marker position (profile, face toward +x). */
  side: { x: number; y: number };
  /** Parent bone for the connection line (same view). */
  parent?: string;
  group: BoneMapGroup;
}

export const BONE_MAP_VIEWBOX = { w: 120, h: 240 } as const;

// Front: her-right limbs on screen-left (x<60), her-left on screen-right (x>60).
// Side: left/right limbs nudged apart in depth so both stay clickable.
export const BONE_MAP_NODES: BoneMapNode[] = [
  // --- torso / head (center chain) ---
  { bone: 'head', label: '頭', group: 'head', front: { x: 60, y: 26 }, side: { x: 64, y: 26 }, parent: 'neck' },
  { bone: 'neck', label: '首', group: 'torso', front: { x: 60, y: 44 }, side: { x: 60, y: 44 }, parent: 'upperChest' },
  { bone: 'upperChest', label: '胸(上)', group: 'torso', front: { x: 60, y: 58 }, side: { x: 58, y: 58 }, parent: 'chest' },
  { bone: 'chest', label: '胸', group: 'torso', front: { x: 60, y: 68 }, side: { x: 57, y: 68 }, parent: 'spine' },
  { bone: 'spine', label: '背骨', group: 'torso', front: { x: 60, y: 86 }, side: { x: 57, y: 86 }, parent: 'hips' },
  { bone: 'hips', label: '腰', group: 'torso', front: { x: 60, y: 104 }, side: { x: 58, y: 104 } },

  // --- right arm (screen-left) ---
  { bone: 'rightShoulder', label: '右肩', group: 'arm', front: { x: 48, y: 52 }, side: { x: 56, y: 53 }, parent: 'upperChest' },
  { bone: 'rightUpperArm', label: '右上腕', group: 'arm', front: { x: 42, y: 66 }, side: { x: 56, y: 66 }, parent: 'rightShoulder' },
  { bone: 'rightLowerArm', label: '右前腕', group: 'arm', front: { x: 36, y: 92 }, side: { x: 60, y: 92 }, parent: 'rightUpperArm' },
  { bone: 'rightHand', label: '右手', group: 'arm', front: { x: 32, y: 116 }, side: { x: 62, y: 116 }, parent: 'rightLowerArm' },

  // --- left arm (screen-right) ---
  { bone: 'leftShoulder', label: '左肩', group: 'arm', front: { x: 72, y: 52 }, side: { x: 60, y: 53 }, parent: 'upperChest' },
  { bone: 'leftUpperArm', label: '左上腕', group: 'arm', front: { x: 78, y: 66 }, side: { x: 60, y: 66 }, parent: 'leftShoulder' },
  { bone: 'leftLowerArm', label: '左前腕', group: 'arm', front: { x: 84, y: 92 }, side: { x: 64, y: 92 }, parent: 'leftUpperArm' },
  { bone: 'leftHand', label: '左手', group: 'arm', front: { x: 88, y: 116 }, side: { x: 66, y: 116 }, parent: 'leftLowerArm' },

  // --- right leg (screen-left) ---
  { bone: 'rightUpperLeg', label: '右もも', group: 'leg', front: { x: 52, y: 124 }, side: { x: 56, y: 124 }, parent: 'hips' },
  { bone: 'rightLowerLeg', label: '右すね', group: 'leg', front: { x: 50, y: 166 }, side: { x: 58, y: 166 }, parent: 'rightUpperLeg' },
  { bone: 'rightFoot', label: '右足', group: 'leg', front: { x: 50, y: 204 }, side: { x: 64, y: 204 }, parent: 'rightLowerLeg' },
  { bone: 'rightToes', label: '右つま先', group: 'leg', front: { x: 54, y: 214 }, side: { x: 72, y: 210 }, parent: 'rightFoot' },

  // --- left leg (screen-right) ---
  { bone: 'leftUpperLeg', label: '左もも', group: 'leg', front: { x: 68, y: 124 }, side: { x: 60, y: 124 }, parent: 'hips' },
  { bone: 'leftLowerLeg', label: '左すね', group: 'leg', front: { x: 70, y: 166 }, side: { x: 62, y: 166 }, parent: 'leftUpperLeg' },
  { bone: 'leftFoot', label: '左足', group: 'leg', front: { x: 70, y: 204 }, side: { x: 68, y: 204 }, parent: 'leftLowerLeg' },
  { bone: 'leftToes', label: '左つま先', group: 'leg', front: { x: 66, y: 214 }, side: { x: 76, y: 210 }, parent: 'leftFoot' },
];

/** Quick lookup by bone name. */
export const BONE_MAP_BY_NAME: Record<string, BoneMapNode> = Object.fromEntries(
  BONE_MAP_NODES.map((n) => [n.bone, n]),
);

/** Japanese label for a bone (falls back to the bone name). */
export function boneLabel(bone: string): string {
  return BONE_MAP_BY_NAME[bone]?.label ?? bone;
}
