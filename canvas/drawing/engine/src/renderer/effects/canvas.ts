/**
 * Canvas2D Effect Rendering
 *
 * Renders ECMA-376 drawing effects (shadows, glow, bevel, soft edges) to
 * Canvas2D contexts. Each function applies a single effect type. Effects
 * must be called in the correct order relative to the main fill/stroke.
 *
 * All size values in effect types are in EMUs (English Metric Units).
 * 1 pixel (96 DPI) = 9525 EMUs.
 *
 * @see ECMA-376 Part 1, Section 20.1.8 (DrawingML - Effects)
 */
import { colorWithOpacity } from '@mog/canvas-engine';
import type { Bevel, PresetMaterialType } from '@mog-sdk/contracts/drawing/three-d';
import type { Path } from '@mog-sdk/contracts/geometry';
import type {
  BevelEffect,
  GlowEffect,
  InnerShadowEffect,
  OuterShadowEffect,
  SoftEdgeEffect,
} from '@mog-sdk/contracts/text-effects';
import { emuToPx } from './utils';

/**
 * Render an outer shadow effect on Canvas2D.
 * Uses Canvas2D shadow properties (shadowColor, shadowBlur, shadowOffsetX/Y).
 * Must be called BEFORE the main fill so shadow appears behind.
 */
export function renderOuterShadowToCanvas(
  shadow: OuterShadowEffect,
  geometry: Path,
  ctx: CanvasRenderingContext2D,
  replayPath: (path: Path, ctx: CanvasRenderingContext2D) => void,
): void {
  ctx.save();

  const blur = emuToPx(shadow.blurRadius);
  const dist = emuToPx(shadow.distance);
  const dirRad = (shadow.direction * Math.PI) / 180;

  ctx.shadowColor = colorWithOpacity(shadow.color, shadow.opacity);
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = Math.cos(dirRad) * dist;
  ctx.shadowOffsetY = Math.sin(dirRad) * dist;

  // Fill the path to create the shadow
  ctx.beginPath();
  replayPath(geometry, ctx);
  ctx.fillStyle = 'rgba(0,0,0,1)'; // Color doesn't matter -- shadow is what we want
  ctx.fill();

  ctx.restore();
}

/**
 * Render an inner shadow effect on Canvas2D.
 * Uses clipping to contain shadow inside the geometry.
 */
export function renderInnerShadowToCanvas(
  shadow: InnerShadowEffect,
  geometry: Path,
  ctx: CanvasRenderingContext2D,
  replayPath: (path: Path, ctx: CanvasRenderingContext2D) => void,
): void {
  ctx.save();

  // Clip to the geometry
  ctx.beginPath();
  replayPath(geometry, ctx);
  ctx.clip();

  const blur = emuToPx(shadow.blurRadius);
  const dist = emuToPx(shadow.distance);
  const dirRad = (shadow.direction * Math.PI) / 180;

  // Create shadow by drawing an inverted (large) rectangle
  // offset in the shadow direction, with shadow properties
  ctx.shadowColor = colorWithOpacity(shadow.color, shadow.opacity);
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = Math.cos(dirRad) * dist;
  ctx.shadowOffsetY = Math.sin(dirRad) * dist;

  // Draw a large rect offset AWAY from the shadow direction
  // The shadow of this rect falls inside the clipped geometry
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.beginPath();
  ctx.rect(
    -10000 - Math.cos(dirRad) * dist * 2,
    -10000 - Math.sin(dirRad) * dist * 2,
    20000,
    20000,
  );
  // Cut out the geometry shape so only the shadow remains
  replayPath(geometry, ctx);
  ctx.fill('evenodd');

  ctx.restore();
}

/**
 * Render a glow effect on Canvas2D.
 * Uses multiple passes with decreasing opacity at increasing stroke widths.
 */
export function renderGlowToCanvas(
  glow: GlowEffect,
  geometry: Path,
  ctx: CanvasRenderingContext2D,
  replayPath: (path: Path, ctx: CanvasRenderingContext2D) => void,
): void {
  const radius = emuToPx(glow.radius);
  const passes = Math.max(3, Math.min(10, Math.ceil(radius / 2)));

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = passes; i >= 1; i--) {
    const fraction = i / passes;
    const alpha = glow.opacity * (1 - fraction) * 0.5;
    const width = radius * 2 * fraction;

    ctx.strokeStyle = colorWithOpacity(glow.color, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    replayPath(geometry, ctx);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Render a soft edge effect (feathered edges).
 * Approximated by drawing the shape with a shadow blur and compositing
 * with 'destination-in' so only the blurred alpha region remains,
 * producing a feathered edge on the original content.
 */
export function renderSoftEdgeToCanvas(
  softEdge: SoftEdgeEffect,
  geometry: Path,
  ctx: CanvasRenderingContext2D,
  replayPath: (path: Path, ctx: CanvasRenderingContext2D) => void,
): void {
  const radius = emuToPx(softEdge.radius);
  ctx.save();

  // Use destination-in to mask the existing content with the blurred shape
  ctx.globalCompositeOperation = 'destination-in';
  ctx.shadowColor = 'rgba(0,0,0,1)';
  ctx.shadowBlur = radius;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Draw the geometry path -- the shadow blur creates a feathered alpha mask
  ctx.beginPath();
  replayPath(geometry, ctx);
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.fill();

  ctx.restore();
}

/**
 * Render a bevel effect (3D edge approximation).
 * Uses light/dark edge strokes to simulate depth.
 */
export function renderBevelToCanvas(
  bevel: BevelEffect,
  geometry: Path,
  ctx: CanvasRenderingContext2D,
  replayPath: (path: Path, ctx: CanvasRenderingContext2D) => void,
): void {
  if (!bevel.topPreset && !bevel.bottomPreset) return;

  ctx.save();

  if (bevel.topPreset) {
    const width = emuToPx(bevel.topWidth || 25400); // 2pt default

    // Light edge (top-left)
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = width;
    ctx.beginPath();
    replayPath(geometry, ctx);
    ctx.stroke();

    // Dark edge (bottom-right) -- offset slightly
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = width * 0.5;
    ctx.beginPath();
    replayPath(geometry, ctx);
    ctx.stroke();
  }

  if (bevel.bottomPreset) {
    const width = emuToPx(bevel.bottomWidth || 25400); // 2pt default

    // Dark edge (top-left) -- inverted lighting for bottom bevel
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = width;
    ctx.beginPath();
    replayPath(geometry, ctx);
    ctx.stroke();

    // Light edge (bottom-right) -- inverted lighting for bottom bevel
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = width * 0.5;
    ctx.beginPath();
    replayPath(geometry, ctx);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Per-bevel-preset specular parameters.
 * Matches the values in svg.ts bevel3DToSVGFilter().
 */
const BEVEL_SPECULAR: Record<string, { constant: number; exponent: number }> = {
  circle: { constant: 0.6, exponent: 20 },
  relaxedInset: { constant: 0.4, exponent: 15 },
  slope: { constant: 0.8, exponent: 30 },
  hardEdge: { constant: 1.0, exponent: 40 },
  softRound: { constant: 0.5, exponent: 12 },
  convex: { constant: 0.7, exponent: 25 },
  cross: { constant: 0.7, exponent: 20 },
  angle: { constant: 0.8, exponent: 25 },
  coolSlant: { constant: 0.5, exponent: 15 },
  divot: { constant: 0.4, exponent: 10 },
  riblet: { constant: 0.6, exponent: 30 },
  artDeco: { constant: 0.9, exponent: 35 },
};

function ensureBevelFilter(
  preset: string,
  position: 'top' | 'bottom',
  w: number,
  h: number,
): string {
  const key = `bvl_${preset}_${position}_${w}_${h}`;
  const cached = filterCache.get(key);
  if (cached) return cached;

  const widthPx = emuToPx(w || 25400);
  const heightPx = emuToPx(h || 25400);
  const surfaceScale = Math.max(1, Math.round((widthPx + heightPx) / 2));
  const spec = BEVEL_SPECULAR[preset] ?? BEVEL_SPECULAR.circle;

  // Bottom bevel: invert the light direction by flipping azimuth
  const azimuth = position === 'top' ? 225 : 45;
  const elevation = position === 'top' ? 55 : 35;

  const primitives =
    `<feSpecularLighting surfaceScale="${surfaceScale}" specularConstant="${spec.constant}" specularExponent="${spec.exponent}" ` +
    `in="SourceAlpha" result="spec" lighting-color="white">` +
    `<feDistantLight azimuth="${azimuth}" elevation="${elevation}"/>` +
    `</feSpecularLighting>` +
    `<feComposite in="spec" in2="SourceAlpha" operator="in"/>`;

  return registerFilter(key, primitives);
}

/**
 * Render a 3D bevel effect on Canvas2D using SVG specular lighting filters.
 *
 * Uses the same per-preset specular constants/exponents as the SVG pipeline
 * (bevel3DToSVGFilter in svg.ts). The filter computes specular highlights
 * from SourceAlpha and outputs the light contribution, which is composited
 * onto the already-drawn shape.
 */
export function render3DBevelToCanvas(
  bevel: Bevel,
  position: 'top' | 'bottom',
  geometry: Path,
  ctx: CanvasRenderingContext2D,
  replayPath: (path: Path, ctx: CanvasRenderingContext2D) => void,
): void {
  const preset = bevel.prst ?? 'circle';
  const filterId = ensureBevelFilter(preset, position, bevel.w ?? 25400, bevel.h ?? 25400);

  ctx.save();
  ctx.filter = `url(#${filterId})`;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  replayPath(geometry, ctx);
  ctx.fill();
  ctx.restore();
}

/**
 * Render a 3D extrusion effect on Canvas2D.
 * Draws offset filled copies of the geometry behind the shape to simulate depth.
 * More layers and larger offsets for deeper extrusions.
 */
export function renderExtrusionToCanvas(
  extrusionH: number, // EMUs
  color: string | undefined,
  geometry: Path,
  ctx: CanvasRenderingContext2D,
  replayPath: (path: Path, ctx: CanvasRenderingContext2D) => void,
): void {
  const depthPx = Math.min(emuToPx(extrusionH), 30); // Cap at 30px
  // More layers for deeper extrusions, 1px per layer for smooth look
  const layers = Math.max(1, Math.min(Math.round(depthPx), 15));
  if (layers <= 0) return;

  const extColor = color ?? '#666666';

  ctx.save();

  // Draw from back to front so nearer layers paint over farther ones
  for (let i = layers; i >= 1; i--) {
    const t = i / layers;
    const offsetX = t * depthPx * 0.7;
    const offsetY = t * depthPx;

    ctx.save();
    ctx.translate(offsetX, offsetY);

    // Darken farther layers, lighten nearer ones for depth shading
    ctx.globalAlpha = 0.6 + 0.4 * (1 - t);
    ctx.fillStyle = extColor;
    ctx.beginPath();
    replayPath(geometry, ctx);
    ctx.fill();

    // Add edge darkening on the farthest layer
    if (i === layers) {
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      replayPath(geometry, ctx);
      ctx.stroke();
    }

    ctx.restore();
  }

  ctx.restore();
}

/**
 * SVG filter element cache for 3D effects.
 *
 * Uses real SVG filter primitives (feSpecularLighting, feDiffuseLighting)
 * applied to Canvas2D via `ctx.filter = url(#id)`. Filters output only the
 * lighting contribution (white specular or diffuse light), which is then
 * composited onto the already-drawn shape using `globalCompositeOperation`.
 *
 * Filter elements are lazily injected into the DOM and cached for reuse.
 */
const filterCache = new Map<string, string>();
let svgFilterContainer: SVGSVGElement | null = null;

/**
 * Get or create the hidden SVG element that hosts filter definitions.
 */
function ensureFilterContainer(): SVGSVGElement {
  if (svgFilterContainer) return svgFilterContainer;
  svgFilterContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgFilterContainer.setAttribute('width', '0');
  svgFilterContainer.setAttribute('height', '0');
  svgFilterContainer.style.position = 'absolute';
  svgFilterContainer.style.pointerEvents = 'none';
  document.body.appendChild(svgFilterContainer);
  return svgFilterContainer;
}

/**
 * Register an SVG filter in the DOM and cache its id.
 */
function registerFilter(key: string, primitives: string): string {
  const id = `__fx_${key}`;
  const container = ensureFilterContainer();
  const filterEl = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  filterEl.setAttribute('id', id);
  filterEl.setAttribute('x', '-20%');
  filterEl.setAttribute('y', '-20%');
  filterEl.setAttribute('width', '140%');
  filterEl.setAttribute('height', '140%');
  filterEl.setAttribute('color-interpolation-filters', 'sRGB');
  filterEl.innerHTML = primitives;
  container.appendChild(filterEl);
  filterCache.set(key, id);
  return id;
}

/**
 * Per-material SVG filter definitions.
 *
 * Each filter outputs the lighting contribution only (masked to SourceAlpha).
 * The result is drawn onto the canvas with `globalCompositeOperation` to
 * add light or shadow on top of the already-rendered shape.
 *
 * - Specular materials: output white highlights via feSpecularLighting
 * - Diffuse materials: output shading via feDiffuseLighting, masked to alpha
 *
 * ECMA-376 material mapping:
 * - Matte family → feDiffuseLighting (soft, no specular)
 * - Plastic family → feSpecularLighting (moderate exponent)
 * - Metal family → feSpecularLighting (high exponent, strong constant)
 * - Clear → feSpecularLighting (very high constant, sharp highlight)
 */
function getMaterialFilterPrimitives(material: string): string | null {
  // All specular filters: output = specular light masked to source alpha shape
  // feSpecularLighting outputs white light; we mask it to the shape's alpha
  // and composite it additively onto the canvas.
  switch (material) {
    case 'flat':
    case 'legacyWireframe':
      return null;

    case 'matte':
    case 'legacyMatte':
      return (
        '<feDiffuseLighting surfaceScale="4" diffuseConstant="1.0" in="SourceAlpha" result="lit" lighting-color="white">' +
        '<feDistantLight azimuth="225" elevation="45"/>' +
        '</feDiffuseLighting>' +
        '<feComposite in="lit" in2="SourceAlpha" operator="in"/>'
      );
    case 'warmMatte':
      return (
        '<feDiffuseLighting surfaceScale="4" diffuseConstant="1.0" in="SourceAlpha" result="lit" lighting-color="#fff0d0">' +
        '<feDistantLight azimuth="225" elevation="45"/>' +
        '</feDiffuseLighting>' +
        '<feComposite in="lit" in2="SourceAlpha" operator="in"/>'
      );
    case 'powder':
      return (
        '<feDiffuseLighting surfaceScale="6" diffuseConstant="0.8" in="SourceAlpha" result="lit" lighting-color="#f0e8d8">' +
        '<feDistantLight azimuth="225" elevation="50"/>' +
        '</feDiffuseLighting>' +
        '<feComposite in="lit" in2="SourceAlpha" operator="in"/>'
      );
    case 'translucentPowder':
      return (
        '<feDiffuseLighting surfaceScale="5" diffuseConstant="0.9" in="SourceAlpha" result="lit" lighting-color="#f8f0e0">' +
        '<feDistantLight azimuth="225" elevation="50"/>' +
        '</feDiffuseLighting>' +
        '<feComposite in="lit" in2="SourceAlpha" operator="in"/>'
      );

    case 'plastic':
    case 'legacyPlastic':
      return (
        '<feSpecularLighting surfaceScale="4" specularConstant="0.8" specularExponent="20" in="SourceAlpha" result="spec" lighting-color="white">' +
        '<feDistantLight azimuth="225" elevation="55"/>' +
        '</feSpecularLighting>' +
        '<feComposite in="spec" in2="SourceAlpha" operator="in"/>'
      );
    case 'softEdge':
      return (
        '<feGaussianBlur in="SourceAlpha" stdDeviation="1" result="blurred"/>' +
        '<feSpecularLighting surfaceScale="3" specularConstant="0.5" specularExponent="15" in="blurred" result="spec" lighting-color="white">' +
        '<feDistantLight azimuth="225" elevation="50"/>' +
        '</feSpecularLighting>' +
        '<feComposite in="spec" in2="SourceAlpha" operator="in"/>'
      );

    case 'metal':
    case 'legacyMetal':
      return (
        '<feSpecularLighting surfaceScale="6" specularConstant="1.5" specularExponent="40" in="SourceAlpha" result="spec" lighting-color="white">' +
        '<feDistantLight azimuth="225" elevation="60"/>' +
        '</feSpecularLighting>' +
        '<feComposite in="spec" in2="SourceAlpha" operator="in"/>'
      );
    case 'softMetal':
      return (
        '<feSpecularLighting surfaceScale="5" specularConstant="1.2" specularExponent="30" in="SourceAlpha" result="spec" lighting-color="white">' +
        '<feDistantLight azimuth="225" elevation="55"/>' +
        '</feSpecularLighting>' +
        '<feComposite in="spec" in2="SourceAlpha" operator="in"/>'
      );
    case 'dkEdge':
      return (
        '<feSpecularLighting surfaceScale="8" specularConstant="1.8" specularExponent="50" in="SourceAlpha" result="spec" lighting-color="#c0c0c0">' +
        '<feDistantLight azimuth="225" elevation="70"/>' +
        '</feSpecularLighting>' +
        '<feComposite in="spec" in2="SourceAlpha" operator="in"/>'
      );
    case 'clear':
      return (
        '<feSpecularLighting surfaceScale="8" specularConstant="2.0" specularExponent="60" in="SourceAlpha" result="spec" lighting-color="white">' +
        '<feDistantLight azimuth="225" elevation="65"/>' +
        '</feSpecularLighting>' +
        '<feComposite in="spec" in2="SourceAlpha" operator="in"/>'
      );

    default:
      return (
        '<feSpecularLighting surfaceScale="4" specularConstant="0.8" specularExponent="20" in="SourceAlpha" result="spec" lighting-color="white">' +
        '<feDistantLight azimuth="225" elevation="55"/>' +
        '</feSpecularLighting>' +
        '<feComposite in="spec" in2="SourceAlpha" operator="in"/>'
      );
  }
}

function ensureMaterialFilter(material: PresetMaterialType): string | null {
  const key = `mat_${material}`;
  const cached = filterCache.get(key);
  if (cached !== undefined) return cached || null;

  const primitives = getMaterialFilterPrimitives(material);
  if (!primitives) {
    filterCache.set(key, '');
    return null;
  }

  return registerFilter(key, primitives);
}

/**
 * Render a material lighting effect on Canvas2D.
 *
 * Uses real SVG filter primitives (feSpecularLighting / feDiffuseLighting)
 * to compute lighting, then composites the result onto the already-drawn shape.
 *
 * The filter outputs only the light contribution (masked to SourceAlpha).
 * We draw an opaque white fill with the filter active — the filter transforms
 * it into the lighting pattern — then composite it onto the canvas using
 * 'lighter' (additive) for specular or 'multiply' for diffuse materials.
 */
export function renderMaterialToCanvas(
  material: PresetMaterialType,
  geometry: Path,
  ctx: CanvasRenderingContext2D,
  replayPath: (path: Path, ctx: CanvasRenderingContext2D) => void,
): void {
  const filterId = ensureMaterialFilter(material);
  if (!filterId) return;

  ctx.save();

  // Set up the SVG filter — it computes lighting from the drawn shape's alpha
  ctx.filter = `url(#${filterId})`;

  // Draw an opaque white shape; the SVG filter transforms this into
  // the lighting contribution (specular highlight or diffuse shading)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  replayPath(geometry, ctx);
  ctx.fill();

  ctx.restore();
}

// colorWithOpacity is imported from @mog/canvas-engine and re-exported
// from the effects barrel (effects/index.ts) for backward compatibility.
export { colorWithOpacity } from '@mog/canvas-engine';
// Re-export emuToPx from shared utils for backwards compatibility
export { emuToPx } from './utils';
