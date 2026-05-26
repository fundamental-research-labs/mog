/**
 * Pattern Fill — 18 Excel pattern fills as PDF tiling pattern ContentOp sequences.
 *
 * Each pattern generates an 8×8pt repeating tile with two-color support:
 * foreground (pattern marks) and background (fill behind).
 *
 * PDF tiling pattern: /PatternType 1, /PaintType 1, 8×8 BBox.
 */

import type { ContentOp } from './content-ops';
import type { ExcelPatternType } from './pattern-math';
import { TILE_SIZE, getPatternActions, shouldFillPixel } from './pattern-math';

// Re-export for consumers that import from this module
export type { ExcelPatternType } from './pattern-math';

/**
 * Options for a pattern fill.
 */
export interface PatternFillOptions {
  /** Which Excel pattern to use. */
  pattern: ExcelPatternType;
  /** Foreground color (the pattern marks). */
  foreColor: [number, number, number];
  /** Background color (behind the pattern). */
  backColor: [number, number, number];
}

/**
 * A generated pattern with its resource definition and content stream.
 */
export interface PatternDefinition {
  /** Unique resource name for this pattern (e.g., 'P0', 'P1'). */
  name: string;
  /** The pattern tile size. */
  tileWidth: number;
  tileHeight: number;
  /** Content ops that draw the pattern within the tile. */
  tileOps: ContentOp[];
}

/**
 * Cache for pattern definitions to deduplicate identical patterns.
 */
export class PatternCache {
  private _patterns: Map<string, PatternDefinition> = new Map();
  private _nextId = 0;

  /**
   * Get or create a pattern definition for the given options.
   * Returns the pattern resource name.
   */
  getOrCreate(options: PatternFillOptions): PatternDefinition {
    const key = makePatternKey(options);
    const existing = this._patterns.get(key);
    if (existing) return existing;

    const name = `P${this._nextId++}`;
    const tileOps = generatePatternTileOps(options);
    const def: PatternDefinition = {
      name,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
      tileOps,
    };
    this._patterns.set(key, def);
    return def;
  }

  /** Get all registered patterns. */
  getAll(): PatternDefinition[] {
    return Array.from(this._patterns.values());
  }

  /** Clear all cached patterns. */
  clear(): void {
    this._patterns.clear();
    this._nextId = 0;
  }
}

/**
 * Create a unique cache key for a pattern fill configuration.
 */
function makePatternKey(options: PatternFillOptions): string {
  return `${options.pattern}:${options.foreColor.join(',')}:${options.backColor.join(',')}`;
}

/**
 * Generate the ContentOp sequence for a pattern fill applied to a rectangular area.
 *
 * For 'none': returns empty ops.
 * For 'solid': returns a simple fill with foreColor.
 * For other patterns: returns ops to draw background + pattern tile reference.
 */
export function generatePatternFillOps(
  options: PatternFillOptions,
  x: number,
  y: number,
  w: number,
  h: number,
): ContentOp[] {
  if (options.pattern === 'none') return [];

  if (options.pattern === 'solid') {
    const [r, g, b] = options.foreColor;
    return [{ op: 'SetFillColorRGB', r, g, b }, { op: 'Rectangle', x, y, w, h }, { op: 'Fill' }];
  }

  // For patterned fills: draw background, then draw foreground pattern marks
  const ops: ContentOp[] = [];

  // 1. Background fill
  const [br, bg, bb] = options.backColor;
  ops.push({ op: 'SaveState' });
  ops.push({ op: 'SetFillColorRGB', r: br, g: bg, b: bb });
  ops.push({ op: 'Rectangle', x, y, w, h });
  ops.push({ op: 'Fill' });
  ops.push({ op: 'RestoreState' });

  // 2. Foreground pattern marks (clipped to the fill area)
  ops.push({ op: 'SaveState' });
  ops.push({ op: 'Rectangle', x, y, w, h });
  ops.push({ op: 'ClipNonZero' });
  // Emit the tiled pattern marks
  const tileOps = generateTiledPatternOps(options, x, y, w, h);
  ops.push(...tileOps);
  ops.push({ op: 'RestoreState' });

  return ops;
}

/**
 * Generate tiled pattern marks by repeating the tile pattern across the area.
 */
function generateTiledPatternOps(
  options: PatternFillOptions,
  x: number,
  y: number,
  w: number,
  h: number,
): ContentOp[] {
  const ops: ContentOp[] = [];
  const [fr, fg, fb] = options.foreColor;
  ops.push({ op: 'SetFillColorRGB', r: fr, g: fg, b: fb });
  ops.push({ op: 'SetStrokeColorRGB', r: fr, g: fg, b: fb });

  const tilesX = Math.ceil(w / TILE_SIZE);
  const tilesY = Math.ceil(h / TILE_SIZE);

  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tileX = x + tx * TILE_SIZE;
      const tileY = y + ty * TILE_SIZE;
      const marks = generatePatternMarks(options.pattern, tileX, tileY);
      ops.push(...marks);
    }
  }

  return ops;
}

/**
 * Generate the foreground marks for a single tile at the given origin.
 * Each pattern is an 8×8pt tile.
 */
function generatePatternMarks(pattern: ExcelPatternType, ox: number, oy: number): ContentOp[] {
  const actions = getPatternActions(pattern);
  const ops: ContentOp[] = [];
  for (const action of actions) {
    switch (action.type) {
      case 'grayDots':
        ops.push(...generateGrayDots(ox, oy, action.density));
        break;
      case 'horizontalLines':
        ops.push(...generateHorizontalLines(ox, oy, action.lineWidth, action.spacing));
        break;
      case 'verticalLines':
        ops.push(...generateVerticalLines(ox, oy, action.lineWidth, action.spacing));
        break;
      case 'diagonalDown':
        ops.push(...generateDiagonalDown(ox, oy, action.lineWidth));
        break;
      case 'diagonalUp':
        ops.push(...generateDiagonalUp(ox, oy, action.lineWidth));
        break;
    }
  }
  return ops;
}

/**
 * Generate gray dots as small filled rectangles at the given density.
 * density: 0-1, fraction of pixels that are filled.
 */
function generateGrayDots(ox: number, oy: number, density: number): ContentOp[] {
  const ops: ContentOp[] = [];
  // Each "pixel" is 1×1pt in the 8×8 tile
  const pixelSize = 1;
  const totalPixels = TILE_SIZE * TILE_SIZE;
  const filledCount = Math.round(totalPixels * density);

  // Generate a deterministic pattern of filled pixels
  // Use a checkerboard-like distribution for visual uniformity
  let count = 0;
  for (let py = 0; py < TILE_SIZE && count < filledCount; py++) {
    for (let px = 0; px < TILE_SIZE && count < filledCount; px++) {
      if (shouldFillPixel(px, py, density)) {
        ops.push({
          op: 'Rectangle',
          x: ox + px * pixelSize,
          y: oy + py * pixelSize,
          w: pixelSize,
          h: pixelSize,
        });
        count++;
      }
    }
  }

  if (ops.length > 0) {
    ops.push({ op: 'Fill' });
  }

  return ops;
}

/**
 * Generate horizontal line marks within a tile.
 * @param lineWidth Width of each line in points
 * @param spacing Distance between line centers in points
 */
function generateHorizontalLines(
  ox: number,
  oy: number,
  lineWidth: number,
  spacing: number,
): ContentOp[] {
  const ops: ContentOp[] = [];
  ops.push({ op: 'SetLineWidth', width: lineWidth });
  for (let y = spacing / 2; y < TILE_SIZE; y += spacing) {
    ops.push({ op: 'MoveTo', x: ox, y: oy + y });
    ops.push({ op: 'LineTo', x: ox + TILE_SIZE, y: oy + y });
  }
  ops.push({ op: 'Stroke' });
  return ops;
}

/**
 * Generate vertical line marks within a tile.
 * @param lineWidth Width of each line in points
 * @param spacing Distance between line centers in points
 */
function generateVerticalLines(
  ox: number,
  oy: number,
  lineWidth: number,
  spacing: number,
): ContentOp[] {
  const ops: ContentOp[] = [];
  ops.push({ op: 'SetLineWidth', width: lineWidth });
  for (let x = spacing / 2; x < TILE_SIZE; x += spacing) {
    ops.push({ op: 'MoveTo', x: ox + x, y: oy });
    ops.push({ op: 'LineTo', x: ox + x, y: oy + TILE_SIZE });
  }
  ops.push({ op: 'Stroke' });
  return ops;
}

/**
 * Generate diagonal-down (top-left to bottom-right at 45°) line marks.
 * @param lineWidth Width of diagonal lines
 */
function generateDiagonalDown(ox: number, oy: number, lineWidth: number): ContentOp[] {
  const ops: ContentOp[] = [];
  ops.push({ op: 'SetLineWidth', width: lineWidth });
  // Main diagonal
  ops.push({ op: 'MoveTo', x: ox, y: oy });
  ops.push({ op: 'LineTo', x: ox + TILE_SIZE, y: oy + TILE_SIZE });
  // Wrap-around diagonals for seamless tiling
  ops.push({ op: 'MoveTo', x: ox + TILE_SIZE / 2, y: oy });
  ops.push({ op: 'LineTo', x: ox + TILE_SIZE, y: oy + TILE_SIZE / 2 });
  ops.push({ op: 'MoveTo', x: ox, y: oy + TILE_SIZE / 2 });
  ops.push({ op: 'LineTo', x: ox + TILE_SIZE / 2, y: oy + TILE_SIZE });
  ops.push({ op: 'Stroke' });
  return ops;
}

/**
 * Generate diagonal-up (bottom-left to top-right at 45°) line marks.
 * @param lineWidth Width of diagonal lines
 */
function generateDiagonalUp(ox: number, oy: number, lineWidth: number): ContentOp[] {
  const ops: ContentOp[] = [];
  ops.push({ op: 'SetLineWidth', width: lineWidth });
  // Main diagonal (up)
  ops.push({ op: 'MoveTo', x: ox, y: oy + TILE_SIZE });
  ops.push({ op: 'LineTo', x: ox + TILE_SIZE, y: oy });
  // Wrap-around diagonals for seamless tiling
  ops.push({ op: 'MoveTo', x: ox, y: oy + TILE_SIZE / 2 });
  ops.push({ op: 'LineTo', x: ox + TILE_SIZE / 2, y: oy });
  ops.push({ op: 'MoveTo', x: ox + TILE_SIZE / 2, y: oy + TILE_SIZE });
  ops.push({ op: 'LineTo', x: ox + TILE_SIZE, y: oy + TILE_SIZE / 2 });
  ops.push({ op: 'Stroke' });
  return ops;
}

/**
 * Generate the ContentOp sequence for a pattern tile definition.
 * This is the content stream of the tile itself (for PDF tiling pattern objects).
 */
export function generatePatternTileOps(options: PatternFillOptions): ContentOp[] {
  if (options.pattern === 'none') return [];
  if (options.pattern === 'solid') {
    const [r, g, b] = options.foreColor;
    return [
      { op: 'SetFillColorRGB', r, g, b },
      { op: 'Rectangle', x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE },
      { op: 'Fill' },
    ];
  }

  const ops: ContentOp[] = [];

  // Background fill
  const [br, bg, bb] = options.backColor;
  ops.push({ op: 'SetFillColorRGB', r: br, g: bg, b: bb });
  ops.push({ op: 'Rectangle', x: 0, y: 0, w: TILE_SIZE, h: TILE_SIZE });
  ops.push({ op: 'Fill' });

  // Foreground pattern marks
  const [fr, fg, fb] = options.foreColor;
  ops.push({ op: 'SetFillColorRGB', r: fr, g: fg, b: fb });
  ops.push({ op: 'SetStrokeColorRGB', r: fr, g: fg, b: fb });

  const marks = generatePatternMarks(options.pattern, 0, 0);
  ops.push(...marks);

  return ops;
}

// Re-export for consumers that import from this module
export { ALL_PATTERN_TYPES } from './pattern-math';
