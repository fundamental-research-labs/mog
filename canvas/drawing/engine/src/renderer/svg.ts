/**
 * SVG rendering orchestrator.
 *
 * Composes path, fill, stroke, and effect primitives to render
 * a complete DrawingObject as an SVG string. Returns a standalone
 * <svg> element with embedded <defs> for gradients, filters, etc.
 */
import { PathOps } from '@mog/geometry';
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import { compositeEffectsToSVGFilter } from './effects/svg';
import { fillToSVGAttributes } from './fills';
import { computePathBounds } from './path';
import { strokeToSVGAttributes } from './strokes';

/**
 * Render a DrawingObject to an SVG string.
 *
 * Returns a complete `<svg>` element with `<defs>` and `<path>` elements.
 * Supports fills, strokes, effects (via SVG filters), transforms, and
 * recursive child rendering via `<g>` groups.
 */
export function renderDrawingObjectToSVG(
  obj: DrawingObject,
  options?: { width?: number; height?: number },
): string {
  const defs: string[] = [];
  let defCounter = 0;

  function nextId(prefix: string): string {
    return `${prefix}_${defCounter++}`;
  }

  function renderNode(node: DrawingObject): string {
    const parts: string[] = [];
    const pathD = PathOps.pathToSvgString(node.geometry);

    // Collect attributes
    const attrs: Record<string, string> = {};
    attrs.d = pathD;

    // Fill
    if (node.fill) {
      const fillId = nextId('fill');
      const fillResult = fillToSVGAttributes(node.fill, fillId);
      Object.assign(attrs, fillResult.attrs);
      if (fillResult.defs) defs.push(fillResult.defs);
    } else {
      attrs.fill = 'none';
    }

    // Stroke
    if (node.stroke) {
      Object.assign(attrs, strokeToSVGAttributes(node.stroke));
    } else {
      attrs.stroke = 'none';
    }

    // Effects -> SVG filter
    if (node.effects) {
      const filterId = nextId('effect');
      const filterDef = compositeEffectsToSVGFilter(node.effects, filterId);
      if (filterDef) {
        defs.push(filterDef);
        attrs.filter = `url(#${filterId})`;
      }
    }

    // Clip path
    let clipAttr = '';
    if (node.clip) {
      const clipId = nextId('clip');
      const clipD = PathOps.pathToSvgString(node.clip);
      defs.push(`<clipPath id="${clipId}"><path d="${escapeXml(clipD)}"/></clipPath>`);
      clipAttr = ` clip-path="url(#${clipId})"`;
    }

    // Build attribute string
    const attrStr = Object.entries(attrs)
      .map(([k, v]) => `${k}="${escapeXml(v)}"`)
      .join(' ');

    // Transform
    let transformAttr = '';
    if (node.transform) {
      const t = node.transform;
      transformAttr = ` transform="matrix(${t.a},${t.b},${t.c},${t.d},${t.tx},${t.ty})"`;
    }

    if (node.children && node.children.length > 0) {
      // Group with children
      const childSvg = node.children.map((c) => renderNode(c)).join('');
      parts.push(`<g${transformAttr}${clipAttr}>`);
      parts.push(`<path ${attrStr}/>`);
      parts.push(childSvg);
      parts.push('</g>');
    } else {
      parts.push(`<path ${attrStr}${transformAttr}${clipAttr}/>`);
    }

    return parts.join('');
  }

  const body = renderNode(obj);

  // Compute bounds for viewBox
  const bounds = computePathBounds(obj.geometry);
  // Ensure minimum 1px dimensions for degenerate paths (vertical lines, points)
  const viewBoxW = Math.max(bounds.width, 1);
  const viewBoxH = Math.max(bounds.height, 1);
  const w = options?.width ?? viewBoxW;
  const h = options?.height ?? viewBoxH;

  const defsStr = defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${bounds.x} ${bounds.y} ${viewBoxW} ${viewBoxH}">${defsStr}${body}</svg>`;
}

/** Escape special XML characters in attribute values. */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
