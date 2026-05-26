/**
 * Diagram Layout to DrawingObject Conversion
 *
 * Converts a Diagram ComputedLayout into an array of DrawingObjects
 * using shape-engine for geometry generation and the canonical drawing
 * types from contracts.
 *
 * Each Diagram node becomes a DrawingObject with:
 * - Geometry from shape-engine's createDrawingObject()
 * - Fill, stroke, effects mapped from Diagram's pixel-based types
 *   to ECMA-376 canonical types (EMUs)
 * - Text content and styling
 * - Position/rotation via AffineTransform
 *
 * Connectors become DrawingObjects with line path geometry.
 */

import { PathOps } from '@mog/geometry';
import { createDrawingObject, type ShapeVisualProperties } from '@mog/shape-engine';
import type {
  DrawingEffects,
  DrawingFill,
  DrawingObject,
  DrawingStroke,
} from '@mog-sdk/contracts/drawing';
import type { AffineTransform } from '@mog-sdk/contracts/geometry';
import type {
  ComputedConnector,
  ComputedLayout,
  ComputedShape,
  ShapeEffects,
} from '@mog-sdk/contracts/diagram';

// =============================================================================
// Constants
// =============================================================================

/**
 * Conversion factor from pixels to EMUs (English Metric Units).
 * 1 pixel at 96 DPI = 9525 EMUs.
 * 1 point = 12700 EMUs.
 */
const PX_TO_EMU = 9525;

/**
 * Conversion factor for direction: degrees to the ECMA-376 60000ths-of-a-degree unit.
 * (Not used here since OuterShadowEffect.direction is plain degrees.)
 */

// =============================================================================
// Public API
// =============================================================================

/**
 * Convert a Diagram ComputedLayout into an array of DrawingObjects.
 *
 * Each Diagram shape node is converted to a DrawingObject with full geometry,
 * fill, stroke, effects, text, and position transform. Connectors are converted
 * to DrawingObjects with line path geometry.
 *
 * The returned array has connectors first, then shapes, ensuring proper z-order
 * (shapes render on top of connectors).
 *
 * @param layout - The computed layout from the Diagram layout engine
 * @returns Array of DrawingObjects ready for rendering
 */
export function layoutToDrawingObjects(layout: ComputedLayout): DrawingObject[] {
  const connectorObjects = layout.connectors.map(convertConnector);
  const shapeObjects = layout.shapes.map(convertShape);

  // Connectors first (behind), then shapes (in front) for proper z-order
  return [...connectorObjects, ...shapeObjects];
}

// =============================================================================
// Shape Conversion
// =============================================================================

/**
 * Convert a ComputedShape to a DrawingObject.
 */
function convertShape(shape: ComputedShape): DrawingObject {
  const fill = mapFill(shape.fill);
  const stroke = mapStroke(shape.stroke, shape.strokeWidth);
  const effects = mapEffects(shape.effects);
  const text = mapText(shape.text, shape.textStyle);

  const visual: ShapeVisualProperties = {
    fill,
    stroke,
    effects,
    text,
  };

  // Create the drawing object with geometry from shape-engine
  const obj = createDrawingObject(shape.shapeType, shape.width, shape.height, undefined, visual);

  // Apply position transform (spread to avoid mutating the original)
  return {
    ...obj,
    transform: buildTransform(shape.x, shape.y, shape.rotation, shape.width, shape.height),
  };
}

// =============================================================================
// Connector Conversion
// =============================================================================

/**
 * Convert a ComputedConnector to a DrawingObject with line path geometry.
 */
function convertConnector(connector: ComputedConnector): DrawingObject {
  const path = buildConnectorPath(connector);
  const stroke: DrawingStroke = {
    color: connector.stroke,
    width: connector.strokeWidth,
  };

  return {
    geometry: path,
    fill: { type: 'none' },
    stroke,
  };
}

/**
 * Build a geometry Path from a connector's path data.
 */
function buildConnectorPath(connector: ComputedConnector): DrawingObject['geometry'] {
  const { path } = connector;
  const builder = PathOps.createPath();

  if (!path || path.points.length === 0) {
    // Return an empty path
    return builder.toPath();
  }

  const [first, ...rest] = path.points;
  builder.moveTo(first.x, first.y);

  switch (path.type) {
    case 'line': {
      // Simple line: moveTo first point, lineTo second
      if (rest.length > 0) {
        builder.lineTo(rest[0].x, rest[0].y);
      }
      break;
    }

    case 'polyline': {
      // Polyline: moveTo first, lineTo each subsequent
      for (const pt of rest) {
        builder.lineTo(pt.x, pt.y);
      }
      break;
    }

    case 'bezier': {
      // Bezier: points after the first come in groups of 3
      // (controlPoint1, controlPoint2, endPoint)
      const controlPoints = path.controlPoints ?? [];

      if (controlPoints.length >= 2 && rest.length >= 1) {
        // Use control points if available
        let cpIdx = 0;
        for (const endPt of rest) {
          if (cpIdx + 1 < controlPoints.length) {
            builder.curveTo(
              controlPoints[cpIdx].x,
              controlPoints[cpIdx].y,
              controlPoints[cpIdx + 1].x,
              controlPoints[cpIdx + 1].y,
              endPt.x,
              endPt.y,
            );
            cpIdx += 2;
          } else {
            // Fallback to line if not enough control points
            builder.lineTo(endPt.x, endPt.y);
          }
        }
      } else {
        // No control points: groups of 3 from the rest points
        // (cp1, cp2, endPoint) for each bezier segment
        for (let i = 0; i + 2 < rest.length; i += 3) {
          builder.curveTo(
            rest[i].x,
            rest[i].y,
            rest[i + 1].x,
            rest[i + 1].y,
            rest[i + 2].x,
            rest[i + 2].y,
          );
        }
      }
      break;
    }

    default: {
      // Unknown type: treat as polyline
      for (const pt of rest) {
        builder.lineTo(pt.x, pt.y);
      }
      break;
    }
  }

  return builder.toPath();
}

// =============================================================================
// Property Mapping
// =============================================================================

/**
 * Map a CSS color string to a DrawingFill.
 */
function mapFill(fillColor: string): DrawingFill {
  return { type: 'solid', color: fillColor };
}

/**
 * Map stroke color and width to a DrawingStroke.
 */
function mapStroke(strokeColor: string, strokeWidth: number): DrawingStroke {
  return {
    color: strokeColor,
    width: strokeWidth,
  };
}

/**
 * Map Diagram text + textStyle to ShapeVisualProperties text.
 */
function mapText(
  text: string,
  textStyle: ComputedShape['textStyle'],
): ShapeVisualProperties['text'] | undefined {
  if (!text) return undefined;

  return {
    content: text,
    style: {
      fontFamily: textStyle.fontFamily,
      fontSize: textStyle.fontSize,
      fontWeight: textStyle.fontWeight,
      fontStyle: textStyle.fontStyle,
      color: textStyle.color,
      align: textStyle.align,
      verticalAlign: textStyle.verticalAlign,
    },
  };
}

// =============================================================================
// Effects Mapping (Diagram pixel-based -> ECMA-376 EMU-based)
// =============================================================================

/**
 * Map Diagram ShapeEffects to DrawingEffects.
 *
 * Diagram effects use pixel-based values, while DrawingEffects use
 * EMU-based values (ECMA-376 canonical types). This function performs
 * the conversion.
 */
function mapEffects(effects: ShapeEffects): DrawingEffects | undefined {
  // Check if there are any effects to map
  if (
    !effects.shadow &&
    !effects.glow &&
    !effects.reflection &&
    !effects.bevel &&
    !effects.transform3D
  ) {
    return undefined;
  }

  const result: DrawingEffects = {};

  if (effects.shadow) {
    result.outerShadow = [mapShadowToOuterShadow(effects.shadow)];
  }

  if (effects.glow) {
    result.glow = mapGlow(effects.glow);
  }

  if (effects.reflection) {
    result.reflection = mapReflection(effects.reflection);
  }

  if (effects.bevel) {
    result.bevel = mapBevel(effects.bevel);
  }

  if (effects.transform3D) {
    result.transform3D = mapTransform3D(effects.transform3D);
  }

  return result;
}

/**
 * Convert Diagram ShadowEffect (pixel-based) to OuterShadowEffect (EMU-based).
 *
 * - blur (px) -> blurRadius (EMU): multiply by PX_TO_EMU
 * - offsetX/Y (px) -> distance (EMU) and direction (degrees):
 *   - distance = sqrt(offsetX^2 + offsetY^2) * PX_TO_EMU
 *   - direction = atan2(offsetY, offsetX) converted to degrees
 */
function mapShadowToOuterShadow(
  shadow: NonNullable<ShapeEffects['shadow']>,
): NonNullable<DrawingEffects['outerShadow']>[number] {
  const { color, blur, offsetX, offsetY, opacity } = shadow;

  const blurRadius = blur * PX_TO_EMU;
  const distancePx = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
  const distance = distancePx * PX_TO_EMU;

  // atan2 gives radians, convert to degrees
  // ECMA-376 OuterShadowEffect.direction is in plain degrees (not 60000ths)
  let direction = 0;
  if (distancePx > 0) {
    direction = Math.atan2(offsetY, offsetX) * (180 / Math.PI);
    // Normalize to 0-360 range
    if (direction < 0) direction += 360;
  }

  return {
    blurRadius,
    distance,
    direction,
    color,
    opacity,
  };
}

/**
 * Convert Diagram GlowEffect (pixel-based) to ECMA-376 GlowEffect (EMU-based).
 */
function mapGlow(glow: NonNullable<ShapeEffects['glow']>): NonNullable<DrawingEffects['glow']> {
  return {
    radius: glow.radius * PX_TO_EMU,
    color: glow.color,
    opacity: glow.opacity,
  };
}

/**
 * Convert Diagram ReflectionEffect to ECMA-376 ReflectionEffect.
 *
 * Diagram reflection uses simplified pixel-based properties.
 * ECMA-376 reflection uses EMUs and more detailed parameters.
 */
function mapReflection(
  reflection: NonNullable<ShapeEffects['reflection']>,
): NonNullable<DrawingEffects['reflection']> {
  return {
    blurRadius: reflection.blur * PX_TO_EMU,
    startOpacity: reflection.opacity,
    endOpacity: 0,
    distance: reflection.distance * PX_TO_EMU,
    direction: 90, // Reflect downward (standard)
    scaleY: -reflection.size, // Mirror with size factor
  };
}

/**
 * Convert Diagram BevelEffect to ECMA-376 BevelEffect.
 *
 * Diagram bevel uses pixel-based width/height.
 * ECMA-376 bevel uses EMUs.
 */
function mapBevel(bevel: NonNullable<ShapeEffects['bevel']>): NonNullable<DrawingEffects['bevel']> {
  // Map Diagram bevel type names to ECMA-376 BevelPreset names
  const presetMap: Record<string, string> = {
    none: 'relaxedInset', // No direct equivalent; use default
    relaxed: 'relaxedInset',
    circle: 'circle',
    slope: 'slope',
    cross: 'cross',
    angle: 'angle',
    'soft-round': 'softRound',
    convex: 'convex',
    'cool-slant': 'coolSlant',
    divot: 'divot',
    riblet: 'riblet',
    'hard-edge': 'hardEdge',
    'art-deco': 'artDeco',
  };

  const topPreset = presetMap[bevel.type] ?? 'circle';

  return {
    topPreset: topPreset as NonNullable<DrawingEffects['bevel']>['topPreset'],
    topWidth: bevel.width * PX_TO_EMU,
    topHeight: bevel.height * PX_TO_EMU,
  };
}

/**
 * Convert Diagram Transform3DEffect to ECMA-376 Transform3DEffect.
 *
 * Both use degrees for rotation; perspective is already in compatible units.
 */
function mapTransform3D(
  t3d: NonNullable<ShapeEffects['transform3D']>,
): NonNullable<DrawingEffects['transform3D']> {
  return {
    rotationX: t3d.rotationX,
    rotationY: t3d.rotationY,
    rotationZ: t3d.rotationZ,
    perspective: t3d.perspective,
  };
}

// =============================================================================
// Transform Building
// =============================================================================

/**
 * Build an AffineTransform for position and rotation.
 *
 * If rotation is 0, returns a pure translation transform.
 * If rotation is non-zero, composes rotation (around shape center)
 * with translation.
 */
function buildTransform(
  x: number,
  y: number,
  rotation: number,
  width: number,
  height: number,
): AffineTransform {
  if (rotation === 0) {
    // Pure translation
    return { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y };
  }

  // Rotation around the shape center, then translate to position.
  // The shape geometry is generated at origin (0,0) to (width, height).
  // We need to:
  // 1. Translate center to origin: (-width/2, -height/2)
  // 2. Rotate by angle
  // 3. Translate center back: (+width/2, +height/2)
  // 4. Translate to position: (x, y)
  //
  // Combined: T(x + cx, y + cy) * R(theta) * T(-cx, -cy)

  const cx = width / 2;
  const cy = height / 2;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Matrix composition:
  // [cos -sin (cx - cos*cx + sin*cy + x)]
  // [sin  cos (cy - sin*cx - cos*cy + y)]
  // [0    0   1                          ]
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    tx: cx - cos * cx + sin * cy + x,
    ty: cy - sin * cx - cos * cy + y,
  };
}
