/**
 * Dividers Layer
 *
 * Renders freeze pane divider lines at freeze boundaries.
 * These are solid gray lines separating frozen regions from scrolling regions.
 *
 * renderMode: 'once' means NO clip/translate/scale from engine. This layer draws
 * at canvas-absolute CSS pixel coordinates.
 *
 * renderMode: 'once' | canvas: 0 | z-index: 900
 *
 * @module grid-renderer/layers/dividers
 */

import type { FrameContext, RenderRegion } from '@mog/canvas-engine';
import { snapToPixelGrid } from '@mog/canvas-engine';
import type { GridRegionMeta } from '@mog-sdk/contracts/rendering';
import { BaseLayer, type OnceLayerWithChrome } from './base-layer';

// =============================================================================
// Configuration
// =============================================================================

export interface DividersLayerConfig {
  /** Divider line color */
  dividerColor?: string;
  /** Divider line width */
  dividerWidth?: number;
}

const DEFAULT_CONFIG: Required<DividersLayerConfig> = {
  dividerColor: '#b0b0b0',
  dividerWidth: 2,
};

// =============================================================================
// Dividers Layer
// =============================================================================

export class DividersLayer extends BaseLayer implements OnceLayerWithChrome {
  private config: Required<DividersLayerConfig>;

  /**
   * Region layout is provided externally by the coordinator so this "once" layer
   * knows where the frozen/scrolling region boundaries are on the canvas.
   */
  private regions: ReadonlyArray<RenderRegion<GridRegionMeta>> = [];

  constructor(config: DividersLayerConfig = {}) {
    super({
      id: 'dividers',
      zIndex: 900,
      renderMode: 'once',
      canvas: 0,
    });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================================================
  // Data Source Updates
  // ===========================================================================

  /**
   * Set the region layout so dividers know where freeze boundaries are.
   */
  setRegions(regions: ReadonlyArray<RenderRegion<GridRegionMeta>>): void {
    this.regions = regions;
    this.markDirty();
  }

  // ===========================================================================
  // Render
  // ===========================================================================

  render(ctx: CanvasRenderingContext2D, _region: RenderRegion, frame: FrameContext): void {
    if (this.regions.length <= 1) return; // No dividers needed for single region

    const canvasWidth = frame.canvasSize.width;
    const canvasHeight = frame.canvasSize.height;

    // Find freeze boundaries by looking for frozen regions
    // A vertical divider exists if there are frozen-col or frozen-corner regions.
    // A horizontal divider exists if there are frozen-row or frozen-corner regions.
    let verticalDividerX: number | null = null;
    let horizontalDividerY: number | null = null;

    for (const reg of this.regions) {
      const meta = reg.metadata as GridRegionMeta;

      if (meta.isFrozen) {
        // Check scroll behavior to determine divider positions
        if (meta.scrollBehavior === 'none') {
          // Frozen corner - both dividers at its right and bottom edges
          verticalDividerX = reg.bounds.x + reg.bounds.width;
          horizontalDividerY = reg.bounds.y + reg.bounds.height;
        } else if (meta.scrollBehavior === 'row-anchored') {
          // Frozen rows - horizontal divider at bottom edge
          if (horizontalDividerY === null) {
            horizontalDividerY = reg.bounds.y + reg.bounds.height;
          }
        } else if (meta.scrollBehavior === 'col-anchored') {
          // Frozen cols - vertical divider at right edge
          if (verticalDividerX === null) {
            verticalDividerX = reg.bounds.x + reg.bounds.width;
          }
        }
      }
    }

    ctx.save();
    ctx.strokeStyle = this.config.dividerColor;
    ctx.lineWidth = this.config.dividerWidth;

    // Vertical divider (freeze column boundary)
    if (verticalDividerX !== null) {
      const x = snapToPixelGrid(verticalDividerX, frame.dpr);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }

    // Horizontal divider (freeze row boundary)
    if (horizontalDividerY !== null) {
      const y = snapToPixelGrid(horizontalDividerY, frame.dpr);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ===========================================================================
  // Chrome Exemptions (OnceLayerWithChrome)
  // ===========================================================================

  /**
   * Canvas-spanning chrome rects this layer paints. The dividers layer
   * paints exactly two rects (or one, or zero, depending on freeze
   * config): a vertical line spanning the full canvas height at the
   * frozen-cols boundary, and a horizontal line spanning the full canvas
   * width at the frozen-rows boundary. Co-located with the paint code
   * above so that adding a third divider type without updating this
   * method will fail the structural containment test.
   */
  getChromeExemptions(args: {
    readonly layout: {
      readonly regions: ReadonlyArray<{
        readonly bounds: {
          readonly x: number;
          readonly y: number;
          readonly width: number;
          readonly height: number;
        };
      }>;
    };
    readonly canvasWidth: number;
    readonly canvasHeight: number;
    readonly dpr: number;
  }): ReadonlyArray<{ x: number; y: number; width: number; height: number }> {
    const { canvasWidth, canvasHeight } = args;
    const lineWidth = this.config.dividerWidth;
    // Reuse the divider-position discovery logic from `render` — find
    // freeze boundaries by looking at the live region list.
    let verticalDividerX: number | null = null;
    let horizontalDividerY: number | null = null;
    for (const reg of this.regions) {
      const meta = reg.metadata as GridRegionMeta;
      if (!meta.isFrozen) continue;
      if (meta.scrollBehavior === 'none') {
        verticalDividerX = reg.bounds.x + reg.bounds.width;
        horizontalDividerY = reg.bounds.y + reg.bounds.height;
      } else if (meta.scrollBehavior === 'row-anchored') {
        if (horizontalDividerY === null) horizontalDividerY = reg.bounds.y + reg.bounds.height;
      } else if (meta.scrollBehavior === 'col-anchored') {
        if (verticalDividerX === null) verticalDividerX = reg.bounds.x + reg.bounds.width;
      }
    }
    const rects: Array<{ x: number; y: number; width: number; height: number }> = [];
    if (verticalDividerX !== null) {
      rects.push({
        x: verticalDividerX - lineWidth,
        y: 0,
        width: lineWidth * 2,
        height: canvasHeight,
      });
    }
    if (horizontalDividerY !== null) {
      rects.push({
        x: 0,
        y: horizontalDividerY - lineWidth,
        width: canvasWidth,
        height: lineWidth * 2,
      });
    }
    return rects;
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  setConfig(config: Partial<DividersLayerConfig>): void {
    this.config = { ...this.config, ...config };
    this.markDirty();
  }

  getConfig(): Required<DividersLayerConfig> {
    return { ...this.config };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createDividersLayer(config?: DividersLayerConfig): DividersLayer {
  return new DividersLayer(config);
}
