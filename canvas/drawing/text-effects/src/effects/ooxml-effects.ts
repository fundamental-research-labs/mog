/**
 * OOXML Effect Engine
 *
 * Computes rendering data for text effects: shadows, glow, reflection, bevel, and 3D.
 * All functions are pure with no side effects.
 *
 * This module is part of @mog/text-effects-engine.
 *
 * @module ooxml-effects
 */

import type {
  BevelEffect,
  BevelPreset,
  GlowEffect,
  InnerShadowEffect,
  OuterShadowEffect,
  PresetShadowType,
  ReflectionEffect,
  SoftEdgeEffect,
  TextEffects,
  Transform3DEffect,
  WarpedTextPath,
} from '@mog-sdk/contracts/text-effects';

// =============================================================================
// EMU Conversion
// =============================================================================

/**
 * EMU (English Metric Unit) to pixels conversion constant.
 *
 * Derivation:
 * - 1 point = 12700 EMU (ECMA-376 standard)
 * - At 96 DPI: 1 point = 96/72 pixels = 1.333... pixels
 * - Therefore: 1 EMU = (1/12700) * (96/72) pixels
 */
const EMU_TO_PIXELS = (1 / 12700) * (96 / 72);

/**
 * Convert EMU (English Metric Units) value to pixels.
 *
 * @param emu - Value in English Metric Units
 * @returns Value in pixels at 96 DPI
 */
export function emuToPixels(emu: number): number {
  return emu * EMU_TO_PIXELS;
}

// =============================================================================
// Effect Result Types
// =============================================================================

export interface ShadowLayer {
  type: 'outer' | 'inner';
  blur: number;
  offsetX: number;
  offsetY: number;
  color: string;
  opacity: number;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
}

export interface GlowLayer {
  radius: number;
  color: string;
  opacity: number;
}

export interface SoftEdgeMask {
  radius: number;
}

export interface ReflectionLayer {
  blur: number;
  startOpacity: number;
  endOpacity: number;
  distance: number;
  scaleX: number;
  scaleY: number;
  skewX?: number;
  skewY?: number;
}

export interface Transform3DMatrix {
  matrix: number[];
  perspective: number;
}

export interface BevelPaths {
  highlightPath: string;
  highlightColor: string;
  highlightOpacity: number;
  shadowPath: string;
  shadowColor: string;
  shadowOpacity: number;
}

/**
 * Effect render result.
 *
 * Contains all rendering data needed to draw effects.
 * Effects should be applied in this order:
 * 1. Reflection (below main content)
 * 2. Shadows (behind main content)
 * 3. Main text
 * 4. Bevel
 * 5. Glow
 * 6. Soft edge mask
 * 7. 3D transform (applied to glyph positions)
 */
export interface EffectRenderResult {
  shadowLayers: ShadowLayer[];
  glowLayer?: GlowLayer;
  softEdgeMask?: SoftEdgeMask;
  reflectionLayer?: ReflectionLayer;
  transform3D?: Transform3DMatrix;
  bevelPaths?: BevelPaths;
}

// =============================================================================
// Preset Shadow Definitions
// =============================================================================

const PRESET_SHADOWS: Record<PresetShadowType, OuterShadowEffect> = {
  shdw1: {
    blurRadius: 50800,
    distance: 38100,
    direction: 45,
    color: '#000000',
    opacity: 0.5,
    rotateWithShape: true,
  },
  shdw2: {
    blurRadius: 50800,
    distance: 38100,
    direction: 90,
    color: '#000000',
    opacity: 0.5,
    rotateWithShape: true,
  },
  shdw3: {
    blurRadius: 50800,
    distance: 38100,
    direction: 135,
    color: '#000000',
    opacity: 0.5,
    rotateWithShape: true,
  },
  shdw4: {
    blurRadius: 50800,
    distance: 38100,
    direction: 180,
    color: '#000000',
    opacity: 0.5,
    rotateWithShape: true,
  },
  shdw5: {
    blurRadius: 50800,
    distance: 38100,
    direction: 225,
    color: '#000000',
    opacity: 0.5,
    rotateWithShape: true,
  },
  shdw6: {
    blurRadius: 76200,
    distance: 114300,
    direction: 90,
    color: '#000000',
    opacity: 0.35,
    scaleX: 1,
    scaleY: 0.5,
    skewX: -45,
    rotateWithShape: true,
  },
  shdw7: {
    blurRadius: 76200,
    distance: 114300,
    direction: 90,
    color: '#000000',
    opacity: 0.35,
    scaleX: 1,
    scaleY: 0.5,
    skewX: 45,
    rotateWithShape: true,
  },
  shdw8: {
    blurRadius: 101600,
    distance: 152400,
    direction: 90,
    color: '#000000',
    opacity: 0.4,
    scaleX: 1.02,
    scaleY: 0.3,
    rotateWithShape: true,
  },
  shdw9: {
    blurRadius: 101600,
    distance: 152400,
    direction: 270,
    color: '#000000',
    opacity: 0.4,
    scaleX: 1.02,
    scaleY: 0.3,
    rotateWithShape: true,
  },
  shdw10: {
    blurRadius: 127000,
    distance: 0,
    direction: 0,
    color: '#000000',
    opacity: 0.5,
    rotateWithShape: true,
  },
  shdw11: {
    blurRadius: 50800,
    distance: 25400,
    direction: 45,
    color: '#000000',
    opacity: 0.6,
    rotateWithShape: true,
  },
  shdw12: {
    blurRadius: 50800,
    distance: 25400,
    direction: 90,
    color: '#000000',
    opacity: 0.6,
    rotateWithShape: true,
  },
  shdw13: {
    blurRadius: 50800,
    distance: 25400,
    direction: 135,
    color: '#000000',
    opacity: 0.6,
    rotateWithShape: true,
  },
  shdw14: {
    blurRadius: 25400,
    distance: 12700,
    direction: 45,
    color: '#000000',
    opacity: 0.7,
    rotateWithShape: true,
  },
  shdw15: {
    blurRadius: 25400,
    distance: 12700,
    direction: 90,
    color: '#000000',
    opacity: 0.7,
    rotateWithShape: true,
  },
  shdw16: {
    blurRadius: 25400,
    distance: 12700,
    direction: 135,
    color: '#000000',
    opacity: 0.7,
    rotateWithShape: true,
  },
  shdw17: {
    blurRadius: 76200,
    distance: 50800,
    direction: 45,
    color: '#000000',
    opacity: 0.4,
    rotateWithShape: true,
  },
  shdw18: {
    blurRadius: 76200,
    distance: 50800,
    direction: 90,
    color: '#000000',
    opacity: 0.4,
    rotateWithShape: true,
  },
  shdw19: {
    blurRadius: 76200,
    distance: 50800,
    direction: 135,
    color: '#000000',
    opacity: 0.4,
    rotateWithShape: true,
  },
  shdw20: {
    blurRadius: 101600,
    distance: 76200,
    direction: 90,
    color: '#000000',
    opacity: 0.35,
    rotateWithShape: true,
  },
};

// =============================================================================
// Shadow Computation
// =============================================================================

export function computeOuterShadow(config: OuterShadowEffect): ShadowLayer {
  const angleRad = (config.direction * Math.PI) / 180;
  const distance = emuToPixels(config.distance);

  return {
    type: 'outer',
    blur: emuToPixels(config.blurRadius),
    offsetX: Math.cos(angleRad) * distance,
    offsetY: Math.sin(angleRad) * distance,
    color: config.color,
    opacity: config.opacity,
    scaleX: config.scaleX,
    scaleY: config.scaleY,
    skewX: config.skewX,
    skewY: config.skewY,
  };
}

export function computeInnerShadow(config: InnerShadowEffect): ShadowLayer {
  const angleRad = (config.direction * Math.PI) / 180;
  const distance = emuToPixels(config.distance);

  return {
    type: 'inner',
    blur: emuToPixels(config.blurRadius),
    offsetX: Math.cos(angleRad) * distance,
    offsetY: Math.sin(angleRad) * distance,
    color: config.color,
    opacity: config.opacity,
  };
}

export function computePresetShadow(preset: PresetShadowType): ShadowLayer {
  const config = PRESET_SHADOWS[preset];
  return computeOuterShadow(config);
}

export function getPresetShadowTypes(): PresetShadowType[] {
  return Object.keys(PRESET_SHADOWS) as PresetShadowType[];
}

// =============================================================================
// Glow and Soft Edge Computation
// =============================================================================

export function computeGlow(config: GlowEffect): GlowLayer {
  return {
    radius: emuToPixels(config.radius),
    color: config.color,
    opacity: config.opacity,
  };
}

export function computeSoftEdge(config: SoftEdgeEffect): SoftEdgeMask {
  return {
    radius: emuToPixels(config.radius),
  };
}

// =============================================================================
// Reflection Computation
// =============================================================================

export function computeReflection(config: ReflectionEffect): ReflectionLayer {
  const scaleY = config.scaleY ?? -0.5;

  return {
    blur: emuToPixels(config.blurRadius),
    startOpacity: config.startOpacity,
    endOpacity: config.endOpacity,
    distance: emuToPixels(config.distance),
    scaleX: config.scaleX ?? 1,
    scaleY,
    skewX: config.skewX,
    skewY: config.skewY,
  };
}

// =============================================================================
// Bevel Computation
// =============================================================================

interface BevelPresetConfig {
  lightAngle: number;
  softness: number;
  inner: boolean;
  material: 'matte' | 'metallic' | 'plastic';
}

const BEVEL_PRESETS: Record<BevelPreset, BevelPresetConfig> = {
  relaxedInset: { lightAngle: 225, softness: 0.6, inner: true, material: 'matte' },
  circle: { lightAngle: 225, softness: 0.3, inner: false, material: 'matte' },
  slope: { lightAngle: 225, softness: 0.4, inner: false, material: 'plastic' },
  cross: { lightAngle: 225, softness: 0.2, inner: false, material: 'matte' },
  angle: { lightAngle: 225, softness: 0.5, inner: false, material: 'matte' },
  softRound: { lightAngle: 225, softness: 0.8, inner: false, material: 'matte' },
  convex: { lightAngle: 225, softness: 0.4, inner: false, material: 'plastic' },
  coolSlant: { lightAngle: 315, softness: 0.5, inner: false, material: 'metallic' },
  divot: { lightAngle: 225, softness: 0.3, inner: true, material: 'matte' },
  riblet: { lightAngle: 225, softness: 0.2, inner: false, material: 'metallic' },
  hardEdge: { lightAngle: 225, softness: 0.0, inner: false, material: 'plastic' },
  artDeco: { lightAngle: 225, softness: 0.1, inner: false, material: 'metallic' },
};

function getMaterialColors(material: 'matte' | 'metallic' | 'plastic'): {
  highlightColor: string;
  shadowColor: string;
  highlightOpacity: number;
  shadowOpacity: number;
} {
  switch (material) {
    case 'metallic':
      return {
        highlightColor: '#FFFFFF',
        shadowColor: '#000000',
        highlightOpacity: 0.8,
        shadowOpacity: 0.6,
      };
    case 'plastic':
      return {
        highlightColor: '#FFFFFF',
        shadowColor: '#000000',
        highlightOpacity: 0.6,
        shadowOpacity: 0.4,
      };
    case 'matte':
    default:
      return {
        highlightColor: '#FFFFFF',
        shadowColor: '#000000',
        highlightOpacity: 0.4,
        shadowOpacity: 0.3,
      };
  }
}

export function computeBevel(
  config: BevelEffect,
  warpedPath: WarpedTextPath,
  _bounds: { width: number; height: number },
): BevelPaths {
  const topPreset = config.topPreset ?? 'circle';
  const presetConfig = BEVEL_PRESETS[topPreset];

  const { highlightColor, shadowColor, highlightOpacity, shadowOpacity } = getMaterialColors(
    presetConfig.material,
  );

  return {
    highlightPath: warpedPath.topPath,
    highlightColor,
    highlightOpacity,
    shadowPath: warpedPath.topPath,
    shadowColor,
    shadowOpacity,
  };
}

// =============================================================================
// 3D Transform Computation
// =============================================================================

function multiplyMatrix4(a: number[], b: number[]): number[] {
  const result = new Array(16).fill(0);

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 4; k++) {
        result[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
      }
    }
  }

  return result;
}

export function computeTransform3D(config: Transform3DEffect): Transform3DMatrix {
  const rotX = (config.rotationX * Math.PI) / 180;
  const rotY = (config.rotationY * Math.PI) / 180;
  const rotZ = (config.rotationZ * Math.PI) / 180;

  const cosX = Math.cos(rotX),
    sinX = Math.sin(rotX);
  const cosY = Math.cos(rotY),
    sinY = Math.sin(rotY);
  const cosZ = Math.cos(rotZ),
    sinZ = Math.sin(rotZ);

  const Rx = [1, 0, 0, 0, 0, cosX, sinX, 0, 0, -sinX, cosX, 0, 0, 0, 0, 1];
  const Ry = [cosY, 0, -sinY, 0, 0, 1, 0, 0, sinY, 0, cosY, 0, 0, 0, 0, 1];
  const Rz = [cosZ, sinZ, 0, 0, -sinZ, cosZ, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

  const matrix = multiplyMatrix4(Rz, multiplyMatrix4(Ry, Rx));

  const perspective = config.perspective ? emuToPixels(config.perspective) : 1000;

  return {
    matrix,
    perspective,
  };
}

export function transform3DPoint(
  point: { x: number; y: number },
  transform: Transform3DMatrix,
): { x: number; y: number } {
  const { matrix, perspective } = transform;

  const x = point.x;
  const y = point.y;
  const z = 0;
  const w = 1;

  const tx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w;
  const ty = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w;
  const tz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w;

  const pFactor = perspective / (perspective - tz);

  return {
    x: tx * pFactor,
    y: ty * pFactor,
  };
}

export function matrixToCss3d(matrix: number[]): string {
  return `matrix3d(${matrix.join(',')})`;
}

// =============================================================================
// Main Entry Functions
// =============================================================================

export function computeEffects(
  effects: TextEffects | undefined,
  warpedPath: WarpedTextPath,
  bounds: { width: number; height: number },
): EffectRenderResult {
  if (!effects) {
    return { shadowLayers: [] };
  }

  const result: EffectRenderResult = {
    shadowLayers: [],
  };

  if (effects.outerShadow) {
    result.shadowLayers.push(computeOuterShadow(effects.outerShadow));
  }
  if (effects.innerShadow) {
    result.shadowLayers.push(computeInnerShadow(effects.innerShadow));
  }
  if (effects.presetShadow) {
    result.shadowLayers.push(computePresetShadow(effects.presetShadow));
  }

  if (effects.glow) {
    result.glowLayer = computeGlow(effects.glow);
  }

  if (effects.softEdge) {
    result.softEdgeMask = computeSoftEdge(effects.softEdge);
  }

  if (effects.reflection) {
    result.reflectionLayer = computeReflection(effects.reflection);
  }

  if (effects.transform3D) {
    result.transform3D = computeTransform3D(effects.transform3D);
  }

  if (effects.bevel) {
    result.bevelPaths = computeBevel(effects.bevel, warpedPath, bounds);
  }

  return result;
}

export function calculateEffectBounds(
  baseBounds: { x: number; y: number; width: number; height: number },
  effects: TextEffects | undefined,
): { x: number; y: number; width: number; height: number } {
  if (!effects) {
    return baseBounds;
  }

  let { x, y, width, height } = baseBounds;

  if (effects.outerShadow) {
    const shadow = effects.outerShadow;
    const blur = emuToPixels(shadow.blurRadius);
    const dist = emuToPixels(shadow.distance);
    const angleRad = (shadow.direction * Math.PI) / 180;
    const offsetX = Math.cos(angleRad) * dist;
    const offsetY = Math.sin(angleRad) * dist;

    const expansion = blur + Math.max(Math.abs(offsetX), Math.abs(offsetY));
    x -= expansion;
    y -= expansion;
    width += expansion * 2;
    height += expansion * 2;
  }

  if (effects.presetShadow) {
    const presetConfig = PRESET_SHADOWS[effects.presetShadow];
    if (presetConfig) {
      const blur = emuToPixels(presetConfig.blurRadius);
      const dist = emuToPixels(presetConfig.distance);
      const angleRad = (presetConfig.direction * Math.PI) / 180;
      const offsetX = Math.cos(angleRad) * dist;
      const offsetY = Math.sin(angleRad) * dist;

      const scaleExpansion =
        Math.max(Math.abs(presetConfig.scaleX ?? 1) - 1, Math.abs(presetConfig.scaleY ?? 1) - 1) *
        Math.max(width, height);

      const expansion = blur + Math.max(Math.abs(offsetX), Math.abs(offsetY)) + scaleExpansion;
      x -= expansion;
      y -= expansion;
      width += expansion * 2;
      height += expansion * 2;
    }
  }

  if (effects.glow) {
    const radius = emuToPixels(effects.glow.radius);
    x -= radius;
    y -= radius;
    width += radius * 2;
    height += radius * 2;
  }

  if (effects.softEdge) {
    const radius = emuToPixels(effects.softEdge.radius);
    x -= radius;
    y -= radius;
    width += radius * 2;
    height += radius * 2;
  }

  if (effects.reflection) {
    const dist = emuToPixels(effects.reflection.distance);
    const blur = emuToPixels(effects.reflection.blurRadius);
    height += dist + blur + height * Math.abs(effects.reflection.scaleY ?? 0.5);
  }

  return { x, y, width, height };
}
