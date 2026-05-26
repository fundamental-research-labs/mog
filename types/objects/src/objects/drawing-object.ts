/**
 * DrawingObject — Universal Resolved Rendering Primitive
 *
 * This module defines the DrawingObject type, the universal resolved rendering
 * primitive for all drawing systems (shapes, Diagram, TextEffect, ink).
 *
 * All colors are concrete hex/rgba values (NOT theme references). Theme
 * resolution happens upstream in bridges. These types are used for rendering
 * only and are not persisted to Yjs.
 *
 * @see ECMA-376 Part 1, Section 20.1 (DrawingML)
 */

import type { Scene3D, Shape3D } from '../drawing/three-d';
import type { AffineTransform, Path } from '@mog/types-viewport/geometry';
import type {
  BevelEffect,
  GlowEffect,
  InnerShadowEffect,
  OuterShadowEffect,
  ReflectionEffect,
  SoftEdgeEffect,
  Transform3DEffect,
} from '../text-effects/effects';
import type { PatternType } from '../text-effects/types';

// =============================================================================
// Core DrawingObject
// =============================================================================

/**
 * The universal resolved rendering primitive for all drawing systems.
 *
 * A DrawingObject represents a fully-resolved shape ready for rendering.
 * It is the output of bridge resolution — all theme colors, style inheritance,
 * and layout have already been computed. Renderers consume DrawingObjects
 * directly without needing access to theme or document context.
 */
export interface DrawingObject {
  geometry: Path;
  fill?: DrawingFill;
  stroke?: DrawingStroke;
  effects?: DrawingEffects;
  scene3d?: Scene3D;
  sp3d?: Shape3D;
  text?: DrawingTextBody;
  transform?: AffineTransform;
  clip?: Path;
  children?: DrawingObject[];
}

// =============================================================================
// Fill Types
// =============================================================================

/** Discriminated union for all resolved fill types. Post-theme-resolution using CSS color strings. OOXML raw version (with DrawingColor) is in ooxml-types.ts bridge. */
export type DrawingFill =
  | { type: 'solid'; color: string; opacity?: number }
  | { type: 'linear-gradient'; angle: number; stops: GradientStop[] }
  | {
      type: 'radial-gradient';
      centerX: number;
      centerY: number;
      radiusX: number;
      radiusY: number;
      stops: GradientStop[];
    }
  | { type: 'pattern'; pattern: PatternType; foreground: string; background: string }
  | { type: 'image'; src: string; stretch?: boolean; tile?: boolean; crop?: ImageCrop }
  | { type: 'none' };

/** GradientStop — Drawing object layer. Maps to CT_GradientStop (dml-main.xsd:1539) with resolved offset + color + opacity. */
export interface GradientStop {
  offset: number;
  color: string;
  opacity?: number;
}

/** Crop insets for an image fill (as fractions or absolute values). */
export interface ImageCrop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// =============================================================================
// Stroke Types
// =============================================================================

/** Resolved stroke/outline for a drawing object. */
export interface DrawingStroke {
  color: string;
  width: number;
  opacity?: number;
  dash?: DashStyle;
  cap?: 'flat' | 'round' | 'square';
  join?: 'miter' | 'round' | 'bevel';
  compound?: 'single' | 'double' | 'thickThin' | 'thinThick' | 'triple';
}

/** Line dash pattern styles. Maps to ST_PresetLineDashVal (ECMA-376, dml-main.xsd). */
export type DashStyle =
  | 'solid'
  | 'dash'
  | 'dot'
  | 'dashDot'
  | 'dashDotDot'
  | 'longDash'
  | 'longDashDot'
  | 'longDashDotDot';

// =============================================================================
// Effects
// =============================================================================

/**
 * Resolved visual effects for a drawing object.
 *
 * Uses the canonical ECMA-376 effect types from the TextEffect effects module.
 * Note that outerShadow and innerShadow are arrays (a shape can have multiple).
 */
export interface DrawingEffects {
  outerShadow?: OuterShadowEffect[];
  innerShadow?: InnerShadowEffect[];
  glow?: GlowEffect;
  softEdge?: SoftEdgeEffect;
  reflection?: ReflectionEffect;
  bevel?: BevelEffect;
  transform3D?: Transform3DEffect;
}

// =============================================================================
// Text Body
// =============================================================================

/** Text content within a drawing object (e.g., text inside a shape). */
export interface DrawingTextBody {
  paragraphs: DrawingTextParagraph[];
  insets: { top: number; right: number; bottom: number; left: number };
  anchor: 'top' | 'middle' | 'bottom';
  wrap: boolean;
  direction?: 'horizontal' | 'vertical' | 'vertical270';
  autofit?: 'none' | 'shrink' | 'resize-shape';
}

/** A single paragraph within a drawing text body. */
export interface DrawingTextParagraph {
  runs: DrawingTextRun[];
  align?: 'left' | 'center' | 'right' | 'justify';
  spacing?: { before?: number; after?: number; line?: number };
}

/** A run of text with uniform styling. */
export interface DrawingTextRun {
  text: string;
  style?: DrawingTextStyle;
}

/** Resolved text styling for a drawing text run. */
export interface DrawingTextStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  color?: string;
}
