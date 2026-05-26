/**
 * Drawing Object Output
 *
 * Maps TextEffect warp output to DrawingObject[] (one per warped glyph).
 * Replaces the old render-plan system with the universal DrawingObject primitive.
 */
import { PathOps } from '@mog/geometry';
import type {
  DrawingEffects,
  DrawingFill,
  DrawingObject,
  DrawingStroke,
} from '@mog-sdk/contracts/drawing';
import type { Path } from '@mog-sdk/contracts/geometry';
import type { TextEffects, WarpedTextPath } from '@mog-sdk/contracts/text-effects';
import { computeEffects, computeTransform3D } from './effects/ooxml-effects';
import type { TextEffectStyle } from './effects/style-presets';
import { compute3DTransform } from './effects/three-d';
import type { WarpPresetName } from './presets/registry';
import { getWarpPreset } from './presets/registry';
import type { GlyphBox, WarpedGlyph } from './warp/warp-engine';
import { warpText } from './warp/warp-engine';

/**
 * Convert TextEffect text + warp preset into DrawingObject[] (one per warped glyph).
 *
 * Each WarpedGlyph becomes a DrawingObject with:
 * - geometry: a rectangular path from the warped glyph corners
 * - fill: mapped from TextEffectStyle.fill
 * - stroke: mapped from TextEffectStyle.outline
 * - effects: mapped from TextEffectStyle.shadow
 * - transform: the glyph's affine transform (from warp computation)
 *
 * If style has threeDRotation, the entire set of glyphs is wrapped in a parent
 * DrawingObject with the 3D transform applied, mirroring the old render plan's
 * group-with-transform approach.
 *
 * @param glyphs Input glyph boxes for each character
 * @param presetName Warp preset name (e.g. 'textArchUp')
 * @param width Shape width
 * @param height Shape height
 * @param adjustment Optional adjustment value (uses preset default if omitted)
 * @param style Optional TextEffect style (fill, outline, shadow, 3D)
 * @param ooxmlEffects Optional full OOXML effects (replaces style.shadow when provided)
 * @returns Array of DrawingObjects
 */
export function warpToDrawingObjects(
  glyphs: GlyphBox[],
  presetName: WarpPresetName,
  width: number,
  height: number,
  adjustment?: number,
  style?: TextEffectStyle,
  ooxmlEffects?: TextEffects,
): DrawingObject[] {
  if (glyphs.length === 0) return [];

  // Get preset and compute guide paths
  const preset = getWarpPreset(presetName);
  const adj = adjustment ?? preset.defaultAdjustment;
  const topPath = preset.topGuide(width, height, adj);
  const bottomPath = preset.bottomGuide(width, height, adj);

  // Warp the glyphs
  const warped = warpText(glyphs, topPath, bottomPath);

  if (warped.length === 0) return [];

  // Map each warped glyph to a DrawingObject
  const glyphObjects: DrawingObject[] = warped.map((glyph) => {
    const obj: DrawingObject = {
      geometry: glyphToPath(glyph),
      transform: glyph.transform,
    };

    // Map style properties
    if (style) {
      obj.fill = mapFill(style.fill);
      if (style.outline) {
        obj.stroke = mapOutline(style.outline);
      }
    } else {
      // Default: solid black fill
      obj.fill = { type: 'solid', color: '#000000' };
    }

    return obj;
  });

  const result: DrawingObject[] = [];

  // When ooxmlEffects is provided, it replaces the simple style.shadow mapping
  if (ooxmlEffects) {
    // Create a minimal WarpedTextPath stub for computeEffects (needed by computeBevel)
    const stubWarpedPath: WarpedTextPath = {
      topPath: pathToSvgString(topPath),
      bottomPath: pathToSvgString(bottomPath),
      glyphTransforms: [],
      bounds: { x: 0, y: 0, width, height },
    };

    const effectResult = computeEffects(ooxmlEffects, stubWarpedPath, { width, height });
    const drawingEffects = mapOoxmlEffects(ooxmlEffects, effectResult);

    if (drawingEffects) {
      for (const obj of glyphObjects) {
        obj.effects = drawingEffects;
      }
    }

    // When ooxmlEffects has transform3D, use the full 4x4 matrix projected to 2D affine
    if (ooxmlEffects.transform3D) {
      const transform3DMatrix = computeTransform3D(ooxmlEffects.transform3D);
      // Project 4x4 matrix to 2D affine by extracting the top-left 2x2 + translation
      const m = transform3DMatrix.matrix;
      const p = transform3DMatrix.perspective;
      // Perspective-corrected 2D affine approximation
      const pFactor = p / (p - 0); // z=0 for the base plane
      const affine = {
        a: m[0] * pFactor,
        b: m[1] * pFactor,
        c: m[4] * pFactor,
        d: m[5] * pFactor,
        tx: m[12] * pFactor,
        ty: m[13] * pFactor,
      };

      result.push({
        geometry: { segments: [], closed: false },
        transform: affine,
        children: glyphObjects,
      });
    } else if (style?.threeDRotation) {
      // Fall back to 2D affine approximation from three-d.ts
      const combinedBounds = computeCombinedBounds(topPath, bottomPath);
      const transform3D = compute3DTransform(style.threeDRotation, combinedBounds);

      result.push({
        geometry: { segments: [], closed: false },
        transform: transform3D,
        children: glyphObjects,
      });
    } else {
      result.push(...glyphObjects);
    }
  } else {
    // Legacy path: use simple style.shadow mapping
    if (style?.shadow) {
      const effects = mapShadow(style.shadow);
      for (const obj of glyphObjects) {
        obj.effects = effects;
      }
    }

    // If 3D transform is configured, wrap glyphs in a parent DrawingObject
    if (style?.threeDRotation) {
      const combinedBounds = computeCombinedBounds(topPath, bottomPath);
      const transform3D = compute3DTransform(style.threeDRotation, combinedBounds);

      result.push({
        geometry: { segments: [], closed: false },
        transform: transform3D,
        children: glyphObjects,
      });
    } else {
      result.push(...glyphObjects);
    }
  }

  return result;
}

/** Compute the combined bounding box from top and bottom guide paths. */
function computeCombinedBounds(topPath: Path, bottomPath: Path) {
  const topBounds = PathOps.pathBoundingBox(topPath);
  const bottomBounds = PathOps.pathBoundingBox(bottomPath);
  return {
    x: Math.min(topBounds.x, bottomBounds.x),
    y: Math.min(topBounds.y, bottomBounds.y),
    width:
      Math.max(topBounds.x + topBounds.width, bottomBounds.x + bottomBounds.width) -
      Math.min(topBounds.x, bottomBounds.x),
    height:
      Math.max(topBounds.y + topBounds.height, bottomBounds.y + bottomBounds.height) -
      Math.min(topBounds.y, bottomBounds.y),
  };
}

/** Serialize a Path to an SVG path string. */
function pathToSvgString(path: Path): string {
  return path.segments
    .map((seg) => {
      switch (seg.type) {
        case 'M':
          return `M${seg.x},${seg.y}`;
        case 'L':
          return `L${seg.x},${seg.y}`;
        case 'C':
          return `C${seg.x1},${seg.y1},${seg.x2},${seg.y2},${seg.x},${seg.y}`;
        case 'Q':
          return `Q${seg.x1},${seg.y1},${seg.x},${seg.y}`;
        case 'Z':
          return 'Z';
        default:
          return '';
      }
    })
    .join('');
}

/** Map OOXML EffectRenderResult to DrawingEffects. */
function mapOoxmlEffects(
  effects: TextEffects,
  _effectResult: import('./effects/ooxml-effects').EffectRenderResult,
): DrawingEffects | undefined {
  const drawingEffects: DrawingEffects = {};
  let hasEffects = false;

  if (effects.outerShadow) {
    drawingEffects.outerShadow = [effects.outerShadow];
    hasEffects = true;
  }
  if (effects.presetShadow) {
    // Preset shadows map to outerShadow entries via the preset definitions
    // The raw OOXML type is already an OuterShadowEffect internally
    if (!drawingEffects.outerShadow) {
      drawingEffects.outerShadow = [];
    }
    // Preset shadow is referenced by type name; the DrawingEffects expects the raw effect
    // We don't expand here -- consumers can use computePresetShadow() for pixel values
    hasEffects = true;
  }
  if (effects.innerShadow) {
    drawingEffects.innerShadow = [effects.innerShadow];
    hasEffects = true;
  }
  if (effects.glow) {
    drawingEffects.glow = effects.glow;
    hasEffects = true;
  }
  if (effects.softEdge) {
    drawingEffects.softEdge = effects.softEdge;
    hasEffects = true;
  }
  if (effects.reflection) {
    drawingEffects.reflection = effects.reflection;
    hasEffects = true;
  }
  if (effects.bevel) {
    drawingEffects.bevel = effects.bevel;
    hasEffects = true;
  }
  if (effects.transform3D) {
    drawingEffects.transform3D = effects.transform3D;
    hasEffects = true;
  }

  return hasEffects ? drawingEffects : undefined;
}

/** Create a rectangular path from warped glyph corners. */
function glyphToPath(glyph: WarpedGlyph): Path {
  const [tl, tr, br, bl] = glyph.corners;
  return {
    segments: [
      { type: 'M' as const, x: tl.x, y: tl.y },
      { type: 'L' as const, x: tr.x, y: tr.y },
      { type: 'L' as const, x: br.x, y: br.y },
      { type: 'L' as const, x: bl.x, y: bl.y },
      { type: 'Z' as const },
    ],
    closed: true,
  };
}

/** Map TextEffectStyle.fill to DrawingFill. */
function mapFill(fill: TextEffectStyle['fill']): DrawingFill {
  if (fill.type === 'none') return { type: 'none' };
  if (fill.type === 'solid') {
    return { type: 'solid', color: fill.color ?? '#000000' };
  }
  if (fill.type === 'gradient' && fill.gradient) {
    const stops = fill.gradient.stops.map((s) => ({
      offset: s.position,
      color: s.color,
    }));
    if (fill.gradient.type === 'radial') {
      return {
        type: 'radial-gradient',
        centerX: 0.5,
        centerY: 0.5,
        radiusX: 0.5,
        radiusY: 0.5,
        stops,
      };
    }
    return {
      type: 'linear-gradient',
      angle: fill.gradient.angle ?? 0,
      stops,
    };
  }
  return { type: 'none' };
}

/** Map TextEffectStyle.outline to DrawingStroke. */
function mapOutline(outline: NonNullable<TextEffectStyle['outline']>): DrawingStroke {
  return {
    color: outline.color,
    width: outline.width,
  };
}

/** Map TextEffectStyle.shadow to DrawingEffects. */
function mapShadow(shadow: NonNullable<TextEffectStyle['shadow']>): DrawingEffects {
  // Convert local shadow format to ECMA-376 OuterShadowEffect
  const direction = Math.atan2(shadow.offsetY, shadow.offsetX) * (180 / Math.PI);
  const distance = Math.sqrt(shadow.offsetX ** 2 + shadow.offsetY ** 2);
  // Convert pixels to EMUs (1px = 9525 EMU)
  const EMU_PER_PX = 9525;

  return {
    outerShadow: [
      {
        blurRadius: shadow.blur * EMU_PER_PX,
        distance: distance * EMU_PER_PX,
        direction,
        color: shadow.color,
        opacity: shadow.opacity,
      },
    ],
  };
}
