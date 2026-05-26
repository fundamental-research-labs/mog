/**
 * Shared rendering primitives for the PDF pipeline.
 *
 * Hoisted out of `cell-renderer.ts` so that peer renderers
 * (border-renderer, cf-renderer, sparkline-renderer, number-format-renderer,
 * ...) can depend on these geometry/style descriptors without creating an
 * import cycle back through `cell-renderer.ts`.
 *
 * Only pure data types live here -- no backend references, no logic.
 */

/**
 * Axis-aligned rectangle used to position renderable content (cells,
 * sparklines, conditional-format overlays, etc.) in PDF user space.
 */
export interface CellBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Excel border-side styling descriptor.
 *
 * Covers all 13 Excel border styles plus an RGB color in the
 * normalized `[0..1]` range used by the PDF render backend.
 */
export interface BorderStyle {
  style:
    | 'thin'
    | 'medium'
    | 'thick'
    | 'hair'
    | 'dashed'
    | 'dotted'
    | 'double'
    | 'dashDot'
    | 'dashDotDot'
    | 'mediumDashed'
    | 'mediumDashDot'
    | 'mediumDashDotDot'
    | 'slantDashDot';
  color: [number, number, number];
}
