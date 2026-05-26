/**
 * Drawing PDF Renderer — renders drawing objects (shapes, groups, SmartArt, WordArt)
 * into the PDF via the pdf/graphics drawing-renderer.
 *
 * This module bridges the print-export pipeline with the pdf/graphics
 * renderDrawingObject() function, handling:
 * - Coordinate translation from sheet space to page space
 * - Save/restore of graphics state around each drawing
 * - Z-order preservation (drawings are rendered front-to-back in array order)
 * - Ink annotation handling (skipped with warning — rasterization deferred)
 */

import type { DrawingObject, RenderBackend } from '@mog/pdf-graphics';
import { renderDrawingObject } from '@mog/pdf-graphics';
import type { FloatingObjectAnchor, PositionResolver } from './position-resolver';

// ============================================================================
// Types
// ============================================================================

/**
 * Drawing information from the data provider.
 *
 * The drawingObject field contains the resolved drawing object tree
 * (shapes, groups, images, text). SmartArt and WordArt are pre-resolved
 * into DrawingObject trees by the drawing engine before reaching this layer.
 */
export interface DrawingInfo {
  /** Drawing object tree from the drawing engine. */
  drawingObject: DrawingObject;
  /** Anchor in sheet coordinates. */
  anchor: FloatingObjectAnchor;
  /** Width in points. */
  width: number;
  /** Height in points. */
  height: number;
  /** Alt text for accessibility. */
  altText?: string;
}

// ============================================================================
// Renderer
// ============================================================================

/**
 * Renders drawing objects to a PDF page via the RenderBackend.
 *
 * Delegates the actual shape/group/image/text rendering to
 * renderDrawingObject() from @mog/pdf-graphics, which handles:
 * - Shape paths (custom and preset geometries)
 * - Solid, gradient, and pattern fills
 * - Stroke styles (dash patterns, caps, joins)
 * - Text within shapes
 * - Recursive group rendering
 * - Embedded images within drawings
 *
 * This renderer adds:
 * - Position translation from sheet coordinates to page coordinates
 * - Graphics state isolation (save/restore around each drawing)
 * - Multi-page filtering (only render drawings on the target page)
 *
 * Usage:
 *   const renderer = new DrawingPdfRenderer(backend);
 *   renderer.renderDrawing(drawingInfo, { x: 100, y: 200 });
 *
 * Or for a full page:
 *   renderer.renderDrawings(drawings, positionResolver, pageIndex);
 */
export class DrawingPdfRenderer {
  constructor(private backend: RenderBackend) {}

  /**
   * Render a single drawing at a resolved page position.
   *
   * The graphics state is saved before rendering and restored after,
   * ensuring that drawing transforms and style changes do not leak
   * into subsequent rendering operations.
   *
   * @param drawing  Drawing info with the resolved DrawingObject tree
   * @param position Resolved (x, y) position on the page in points
   */
  renderDrawing(drawing: DrawingInfo, position: { x: number; y: number }): void {
    this.backend.save();
    this.backend.translate(position.x, position.y);

    // Delegate to pdf/graphics drawing renderer
    // Note: renderDrawingObject signature is (obj, backend)
    renderDrawingObject(drawing.drawingObject, this.backend);

    this.backend.restore();
  }

  /**
   * Render all drawings that belong to a specific page.
   *
   * Drawings are processed in array order, which corresponds to z-order
   * (first element = back, last element = front). This matches the
   * Excel drawing order convention.
   *
   * Drawings whose anchor resolves to a different page or falls outside
   * all page slices are silently skipped.
   *
   * @param drawings         All drawings for the sheet, sorted by z-order
   * @param positionResolver Converts sheet anchors to page positions
   * @param pageIndex        The target page (0-indexed)
   */
  renderDrawings(
    drawings: DrawingInfo[],
    positionResolver: PositionResolver,
    pageIndex: number,
  ): void {
    for (const drawing of drawings) {
      const pos = positionResolver.resolvePosition(
        drawing.anchor.row,
        drawing.anchor.col,
        drawing.anchor.xOffset,
        drawing.anchor.yOffset,
      );
      if (pos && pos.pageIndex === pageIndex) {
        this.renderDrawing(drawing, { x: pos.x, y: pos.y });
      }
    }
  }
}
