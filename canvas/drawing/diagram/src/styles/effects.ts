/**
 * Diagram Effects System
 *
 * Implements visual effects for Diagram shapes including:
 * - Shadow presets (outer, inner, perspective)
 * - Glow effects (small, medium, large)
 * - Bevel effects (all 13 Excel bevel types)
 *
 * Provides both SVG filter generation and Canvas rendering support.
 *
 * @see contracts/src/diagram/types.ts for effect type definitions
 */

import { BoundedCache } from '@mog/geometry';
import type { BevelEffect, ShadowEffect, ShapeEffects } from '@mog-sdk/contracts/diagram';
import type { GlowEffect } from '@mog-sdk/contracts/text-effects';

// =============================================================================
// Bevel Types
// =============================================================================

/**
 * All 13 Excel bevel types.
 */
export const BEVEL_TYPES = [
  'none',
  'relaxed',
  'circle',
  'slope',
  'cross',
  'angle',
  'soft-round',
  'convex',
  'cool-slant',
  'divot',
  'riblet',
  'hard-edge',
  'art-deco',
] as const;

export type BevelType = (typeof BEVEL_TYPES)[number];

// =============================================================================
// Shadow Presets
// =============================================================================

/**
 * Create a shadow effect from a preset.
 *
 * @param preset - The shadow preset name
 * @returns ShadowEffect configuration or undefined for 'none'
 *
 * @example
 * const shadow = createShadow('outer');
 * // { color: 'rgb(0,0,0)', blur: 8, offsetX: 4, offsetY: 4, opacity: 0.4 }
 */
export function createShadow(
  preset: 'none' | 'outer' | 'inner' | 'perspective',
): ShadowEffect | undefined {
  switch (preset) {
    case 'none':
      return undefined;
    case 'outer':
      return {
        color: 'rgb(0,0,0)',
        blur: 8,
        offsetX: 4,
        offsetY: 4,
        opacity: 0.4,
      };
    case 'inner':
      return {
        color: 'rgb(0,0,0)',
        blur: 4,
        offsetX: -2,
        offsetY: -2,
        opacity: 0.3,
      };
    case 'perspective':
      return {
        color: 'rgb(0,0,0)',
        blur: 12,
        offsetX: 6,
        offsetY: 6,
        opacity: 0.45,
      };
  }
}

// =============================================================================
// Glow Effects
// =============================================================================

/**
 * Create a glow effect with a specific size.
 *
 * @param color - The glow color (CSS color string)
 * @param size - The glow size preset
 * @returns GlowEffect configuration
 *
 * @example
 * const glow = createGlow('#4472C4', 'medium');
 * // { color: '#4472C4', radius: 8, opacity: 0.5 }
 */
export function createGlow(color: string, size: 'small' | 'medium' | 'large'): GlowEffect {
  const radiusMap = { small: 4, medium: 8, large: 16 };
  return {
    color,
    radius: radiusMap[size],
    opacity: 0.5,
  };
}

// =============================================================================
// Bevel Effects
// =============================================================================

/**
 * Size configurations for each bevel type.
 */
const BEVEL_SIZES: Record<BevelType, { width: number; height: number }> = {
  none: { width: 0, height: 0 },
  relaxed: { width: 4, height: 4 },
  circle: { width: 6, height: 6 },
  slope: { width: 5, height: 5 },
  cross: { width: 4, height: 4 },
  angle: { width: 6, height: 3 },
  'soft-round': { width: 8, height: 8 },
  convex: { width: 6, height: 6 },
  'cool-slant': { width: 7, height: 4 },
  divot: { width: 4, height: 4 },
  riblet: { width: 3, height: 3 },
  'hard-edge': { width: 5, height: 5 },
  'art-deco': { width: 6, height: 6 },
};

/**
 * Create a bevel effect from a preset type.
 *
 * @param type - The bevel type
 * @returns BevelEffect configuration
 *
 * @example
 * const bevel = createBevel('convex');
 * // { type: 'convex', width: 6, height: 6 }
 */
export function createBevel(type: BevelEffect['type']): BevelEffect {
  // Validate bevel type and fall back to 'relaxed' for invalid types
  const validType = BEVEL_TYPES.includes(type as BevelType) ? (type as BevelType) : 'relaxed';
  const size = BEVEL_SIZES[validType];
  return { type: validType, ...size };
}

// =============================================================================
// SVG Filter Generation
// =============================================================================

/**
 * SVG filter cache to avoid DOM bloat with repeated filters.
 *
 * Maps effect JSON to generated SVG filter string.
 */
const filterCache = new BoundedCache<string, string>(500);

/**
 * Generate SVG filter definitions for effects.
 *
 * Uses caching to avoid DOM bloat when the same effects are used multiple times.
 *
 * @param effects - The shape effects to generate filters for
 * @param filterId - Unique ID for the filter element
 * @returns SVG filter definition string
 *
 * @example
 * const filterDefs = generateSVGFilterDefs(
 *   { shadow: { color: 'rgba(0,0,0,0.3)', blur: 8, offsetX: 4, offsetY: 4, opacity: 0.4 } },
 *   'shape-filter-1'
 * );
 */
export function generateSVGFilterDefs(effects: ShapeEffects, filterId: string): string {
  const cacheKey = JSON.stringify(effects);
  const cached = filterCache.get(cacheKey);
  if (cached) {
    // Replace cached filter ID with the new one
    return cached.replace(/id="[^"]+"/g, `id="${filterId}"`);
  }

  const filters: string[] = [];
  const hasShadow = !!effects.shadow;
  const hasGlow = !!effects.glow;

  filters.push(`<filter id="${filterId}" x="-50%" y="-50%" width="200%" height="200%">`);

  // Shadow effect
  if (hasShadow) {
    const s = effects.shadow!;
    filters.push(`
      <feDropShadow dx="${s.offsetX}" dy="${s.offsetY}" stdDeviation="${s.blur / 2}"
        flood-color="${s.color}" flood-opacity="${s.opacity}" result="shadowResult"/>
    `);
  }

  // Glow effect
  if (hasGlow) {
    const g = effects.glow!;
    filters.push(`
      <feGaussianBlur in="SourceAlpha" stdDeviation="${g.radius}" result="glowBlur"/>
      <feFlood flood-color="${g.color}" flood-opacity="${g.opacity}" result="glowColor"/>
      <feComposite in="glowColor" in2="glowBlur" operator="in" result="glowResult"/>
    `);
  }

  // Final merge: combine all effects with the source graphic
  if (hasShadow && hasGlow) {
    // When both shadow and glow are present, merge all three layers
    filters.push(`
      <feMerge>
        <feMergeNode in="shadowResult"/>
        <feMergeNode in="glowResult"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    `);
  } else if (hasGlow) {
    // Glow only: merge glow with source graphic
    filters.push(`
      <feMerge>
        <feMergeNode in="glowResult"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    `);
  }
  // Shadow only: feDropShadow automatically composites with SourceGraphic

  filters.push('</filter>');

  const result = filters.join('\n');
  filterCache.set(cacheKey, result);
  return result;
}

/**
 * Clear the SVG filter cache.
 *
 * Call this when filters are no longer needed to free memory.
 */
export function clearFilterCache(): void {
  filterCache.clear();
}

/**
 * Generate SVG bevel filter for all 13 bevel types.
 *
 * @param bevel - The bevel effect configuration
 * @param filterId - Unique ID for the filter element
 * @returns SVG filter definition string (empty for 'none')
 */
export function generateSVGBevelFilter(bevel: BevelEffect, filterId: string): string {
  if (bevel.type === 'none') return '';

  const { width: bw, height: bh } = bevel;
  const filters: string[] = [];

  filters.push(`<filter id="${filterId}-bevel" x="-50%" y="-50%" width="200%" height="200%">`);

  switch (bevel.type) {
    case 'relaxed':
    case 'soft-round':
      filters.push(`
        <feGaussianBlur in="SourceAlpha" stdDeviation="${bw / 2}" result="blur"/>
        <feSpecularLighting in="blur" surfaceScale="${bh}" specularConstant="0.75" specularExponent="20" lighting-color="white" result="spec">
          <fePointLight x="-50" y="-50" z="${bw * 10}"/>
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut"/>
        <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>
      `);
      break;

    case 'circle':
      filters.push(`
        <feGaussianBlur in="SourceAlpha" stdDeviation="${bw}" result="blur"/>
        <feSpecularLighting in="blur" surfaceScale="${bh * 2}" specularConstant="1" specularExponent="30" lighting-color="white" result="spec">
          <fePointLight x="0" y="0" z="${bw * 15}"/>
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut"/>
        <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>
      `);
      break;

    case 'slope':
    case 'cool-slant':
      filters.push(`
        <feGaussianBlur in="SourceAlpha" stdDeviation="${bw / 3}" result="blur"/>
        <feSpecularLighting in="blur" surfaceScale="${bh}" specularConstant="0.6" specularExponent="15" lighting-color="white" result="spec">
          <feDistantLight azimuth="45" elevation="45"/>
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut"/>
        <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>
      `);
      break;

    case 'convex':
      filters.push(`
        <feGaussianBlur in="SourceAlpha" stdDeviation="${bw / 2}" result="blur"/>
        <feSpecularLighting in="blur" surfaceScale="${bh * 1.5}" specularConstant="0.8" specularExponent="25" lighting-color="white" result="spec">
          <fePointLight x="0" y="0" z="${bw * 12}"/>
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut"/>
        <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1.2" k4="0"/>
      `);
      break;

    case 'hard-edge':
    case 'angle':
      filters.push(`
        <feConvolveMatrix order="3" kernelMatrix="0 -1 0 -1 5 -1 0 -1 0" divisor="1"/>
        <feComposite in="SourceGraphic" operator="over"/>
      `);
      break;

    case 'cross':
      filters.push(`
        <feGaussianBlur in="SourceAlpha" stdDeviation="${bw / 4}" result="blur"/>
        <feSpecularLighting in="blur" surfaceScale="${bh}" specularConstant="0.7" specularExponent="18" lighting-color="white" result="spec">
          <fePointLight x="0" y="-50" z="${bw * 8}"/>
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut"/>
        <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>
      `);
      break;

    case 'divot':
      filters.push(`
        <feGaussianBlur in="SourceAlpha" stdDeviation="${bw / 2}" result="blur"/>
        <feSpecularLighting in="blur" surfaceScale="-${bh}" specularConstant="0.5" specularExponent="12" lighting-color="white" result="spec">
          <fePointLight x="0" y="0" z="${bw * 8}"/>
        </feSpecularLighting>
        <feComposite in="spec" in2="SourceAlpha" operator="in" result="specOut"/>
        <feComposite in="SourceGraphic" in2="specOut" operator="arithmetic" k1="0" k2="1" k3="0.8" k4="0"/>
      `);
      break;

    case 'riblet':
      filters.push(`
        <feTurbulence type="turbulence" baseFrequency="${1 / bw} 0" numOctaves="2" result="turbulence"/>
        <feDiffuseLighting in="turbulence" lighting-color="white" surfaceScale="${bh}" result="light">
          <feDistantLight azimuth="45" elevation="60"/>
        </feDiffuseLighting>
        <feComposite in="light" in2="SourceAlpha" operator="in" result="lightOut"/>
        <feComposite in="SourceGraphic" in2="lightOut" operator="arithmetic" k1="0" k2="1" k3="0.5" k4="0"/>
      `);
      break;

    case 'art-deco':
      filters.push(`
        <feComponentTransfer>
          <feFuncR type="discrete" tableValues="0 0.25 0.5 0.75 1"/>
          <feFuncG type="discrete" tableValues="0 0.25 0.5 0.75 1"/>
          <feFuncB type="discrete" tableValues="0 0.25 0.5 0.75 1"/>
        </feComponentTransfer>
        <feGaussianBlur stdDeviation="${bw / 4}"/>
      `);
      break;

    default:
      // For any unknown types, use a simple blur as fallback
      filters.push(`
        <feGaussianBlur in="SourceAlpha" stdDeviation="${bw / 2}" result="blur"/>
        <feComposite in="SourceGraphic" in2="blur" operator="over"/>
      `);
  }

  filters.push('</filter>');
  return filters.join('\n');
}

// =============================================================================
// Canvas Rendering
// =============================================================================

/**
 * BOUNDARY FUNCTION: Applies effects to a Canvas rendering context.
 *
 * This function mutates the provided canvas context to apply visual effects
 * before and after drawing a shape. The shape is drawn by calling the
 * provided drawShape callback.
 *
 * @sideEffects Modifies ctx.shadowColor, ctx.shadowBlur, ctx.shadowOffsetX,
 *              ctx.shadowOffsetY, ctx.globalAlpha
 * @pure false
 *
 * @param ctx - The Canvas 2D rendering context to modify
 * @param effects - The shape effects to apply
 * @param drawShape - Callback function that draws the shape
 *
 * @example
 * applyEffectsToCanvas(ctx, { shadow: createShadow('outer') }, () => {
 *   ctx.fillRect(10, 10, 100, 100);
 * });
 */
export function applyEffectsToCanvas(
  ctx: CanvasRenderingContext2D,
  effects: ShapeEffects,
  drawShape: () => void,
): void {
  ctx.save();

  // Apply shadow (before drawing)
  if (effects.shadow) {
    const s = effects.shadow;
    ctx.shadowColor = s.color;
    ctx.shadowBlur = s.blur;
    ctx.shadowOffsetX = s.offsetX;
    ctx.shadowOffsetY = s.offsetY;
  }

  // Draw the shape
  drawShape();

  // Apply glow (draw again with blur)
  if (effects.glow) {
    const g = effects.glow;
    ctx.globalAlpha = g.opacity;
    ctx.shadowColor = g.color;
    ctx.shadowBlur = g.radius * 2;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    drawShape();
  }

  ctx.restore();
}

/**
 * Apply bevel rendering for Canvas (all 13 types).
 *
 * Draws bevel highlights and shadows on top of a shape to create
 * a 3D appearance.
 *
 * @param ctx - The Canvas 2D rendering context
 * @param bevel - The bevel effect configuration
 * @param x - X position of the shape
 * @param y - Y position of the shape
 * @param width - Width of the shape
 * @param height - Height of the shape
 */
export function applyBevelToCanvas(
  ctx: CanvasRenderingContext2D,
  bevel: BevelEffect,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (bevel.type === 'none') return;

  const { width: bw, height: bh } = bevel;

  ctx.save();
  ctx.globalCompositeOperation = 'overlay';

  // Different gradient patterns for each bevel type
  switch (bevel.type) {
    case 'relaxed':
    case 'soft-round':
      applyRadialBevel(ctx, x, y, width, height, 0.4, 0.2);
      break;

    case 'circle':
      applyCircularBevel(ctx, x, y, width, height);
      break;

    case 'slope':
    case 'cool-slant':
      applyDiagonalBevel(ctx, x, y, width, height);
      break;

    case 'cross':
      applyCrossBevel(ctx, x, y, width, height, bw, bh);
      break;

    case 'angle':
    case 'hard-edge':
      applyAngularBevel(ctx, x, y, width, height, bw, bh);
      break;

    case 'convex':
      applyConvexBevel(ctx, x, y, width, height);
      break;

    case 'divot':
      applyDivotBevel(ctx, x, y, width, height);
      break;

    case 'riblet':
      applyRibletBevel(ctx, x, y, width, height, bw);
      break;

    case 'art-deco':
      applyArtDecoBevel(ctx, x, y, width, height, bw, bh);
      break;

    default:
      // Fallback for any unknown bevel types
      applyRadialBevel(ctx, x, y, width, height, 0.3, 0.15);
  }

  ctx.restore();
}

// =============================================================================
// Bevel Helper Functions
// =============================================================================

/**
 * Apply radial bevel - soft top-left highlight, bottom-right shadow.
 */
function applyRadialBevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  highlightOpacity: number,
  shadowOpacity: number,
): void {
  const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
  gradient.addColorStop(0, `rgba(255,255,255,${highlightOpacity})`);
  gradient.addColorStop(0.5, 'rgba(255,255,255,0)');
  gradient.addColorStop(1, `rgba(0,0,0,${shadowOpacity})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
}

/**
 * Apply circular bevel - radial gradient from center.
 */
function applyCircularBevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const r = Math.min(w, h) / 2;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gradient.addColorStop(0, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
}

/**
 * Apply diagonal bevel - gradient from top-left to bottom-right.
 */
function applyDiagonalBevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const gradient = ctx.createLinearGradient(x, y, x + w, y + h);
  gradient.addColorStop(0, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
}

/**
 * Apply cross bevel - horizontal and vertical gradients.
 */
function applyCrossBevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  bw: number,
  bh: number,
): void {
  // Horizontal gradient
  const grad1 = ctx.createLinearGradient(x, y + h / 2 - bh, x, y + h / 2 + bh);
  grad1.addColorStop(0, 'rgba(255,255,255,0.3)');
  grad1.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad1.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = grad1;
  ctx.fillRect(x, y, w, h);

  // Vertical gradient
  const grad2 = ctx.createLinearGradient(x + w / 2 - bw, y, x + w / 2 + bw, y);
  grad2.addColorStop(0, 'rgba(255,255,255,0.3)');
  grad2.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad2.addColorStop(1, 'rgba(0,0,0,0.15)');
  ctx.fillStyle = grad2;
  ctx.fillRect(x, y, w, h);
}

/**
 * Apply angular bevel - sharp edge highlights and shadows.
 */
function applyAngularBevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  bw: number,
  bh: number,
): void {
  // Top edge highlight
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillRect(x, y, w, bh);

  // Left edge highlight
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(x, y, bw, h);

  // Bottom edge shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x, y + h - bh, w, bh);

  // Right edge shadow
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.fillRect(x + w - bw, y, bw, h);
}

/**
 * Apply convex bevel - outward radial gradient.
 */
function applyConvexBevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,0.4)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.8, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
}

/**
 * Apply divot bevel - inward indentation effect.
 */
function applyDivotBevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.3)');
  gradient.addColorStop(0.5, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.7, 'rgba(255,255,255,0)');
  gradient.addColorStop(1, 'rgba(255,255,255,0.25)');
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
}

/**
 * Apply riblet bevel - repeating vertical ridges.
 */
function applyRibletBevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  spacing: number,
): void {
  // Ensure spacing is at least 1 to avoid infinite loops
  const safeSpacing = Math.max(1, spacing);

  for (let i = 0; i < w; i += safeSpacing * 2) {
    const gradient = ctx.createLinearGradient(x + i, y, x + i + safeSpacing, y);
    gradient.addColorStop(0, 'rgba(255,255,255,0.2)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.1)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x + i, y, safeSpacing, h);
  }
}

/**
 * Apply art deco bevel - stepped geometric pattern.
 */
function applyArtDecoBevel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  bw: number,
  bh: number,
): void {
  const steps = 3;
  for (let i = 0; i < steps; i++) {
    const offset = (bw / steps) * i;
    const opacity = 0.3 - i * 0.08;
    ctx.fillStyle = `rgba(255,255,255,${opacity})`;
    ctx.fillRect(x + offset, y + offset, w - offset * 2, bh - offset);
    ctx.fillRect(x + offset, y + offset, bw - offset, h - offset * 2);
  }
}
