/**
 * Image PDF Renderer — renders embedded images (floating and inline) into the PDF.
 *
 * Handles two types of images:
 * 1. **Floating images**: Anchored to a cell but floating above the grid.
 *    Rendered at their full size at the resolved page position.
 * 2. **Inline (cell) images**: Embedded within a cell, scaled to fit
 *    the cell bounds while preserving aspect ratio.
 *
 * Image format selection:
 * - JPEG: Smaller file size, no transparency. Best for photos and charts
 *   with gradients.
 * - PNG: Supports transparency. Best for logos, icons, and drawings
 *   with transparent backgrounds.
 */

import type { ImageFormat, RenderBackend } from '@mog/pdf-graphics';
import type { FloatingObjectAnchor, PositionResolver } from './position-resolver';

// ============================================================================
// Types
// ============================================================================

/**
 * Image information from the data provider.
 */
export interface ImageInfo {
  /** Unique image identifier. */
  id: string;
  /** Raw image data (JPEG or PNG bytes). */
  data: Uint8Array;
  /** Image format. */
  format: ImageFormat;
  /** Anchor in sheet coordinates. */
  anchor: FloatingObjectAnchor;
  /** Display width in points. */
  width: number;
  /** Display height in points. */
  height: number;
  /** Alt text for accessibility. */
  altText?: string;
  /** Whether this is a cell image (inline) vs floating. */
  isInline?: boolean;
}

/**
 * Quality options for image rendering.
 */
export interface ImageQualityOptions {
  /** DPI for rasterized content (default 150). */
  dpi?: number;
  /** JPEG quality 0-100 (default 85). */
  jpegQuality?: number;
}

/**
 * Cell bounds for inline image rendering.
 */
export interface CellImageBounds {
  /** X position of the cell in points. */
  x: number;
  /** Y position of the cell in points. */
  y: number;
  /** Cell width in points. */
  width: number;
  /** Cell height in points. */
  height: number;
}

// ============================================================================
// Renderer
// ============================================================================

/**
 * Renders embedded images to a PDF page via the RenderBackend.
 *
 * Usage:
 *   const renderer = new ImagePdfRenderer(backend, { dpi: 300 });
 *   renderer.renderFloatingImage(image, { x: 100, y: 200 });
 *   renderer.renderInlineImage(image, { x: 10, y: 10, width: 80, height: 20 });
 *
 * Or for a full page:
 *   renderer.renderImages(images, positionResolver, pageIndex);
 */
export class ImagePdfRenderer {
  private qualityOptions: Required<ImageQualityOptions>;

  constructor(
    private backend: RenderBackend,
    qualityOptions: ImageQualityOptions = {},
  ) {
    this.qualityOptions = {
      dpi: qualityOptions.dpi ?? 150,
      jpegQuality: qualityOptions.jpegQuality ?? 85,
    };
  }

  /**
   * Get the current quality options.
   */
  getQualityOptions(): Readonly<Required<ImageQualityOptions>> {
    return this.qualityOptions;
  }

  /**
   * Render a floating image at its resolved page position.
   *
   * The image is drawn at its full display size (width x height)
   * at the given (x, y) position.
   *
   * @param image    Image info with raw data
   * @param position Resolved (x, y) position on the page in points
   */
  renderFloatingImage(image: ImageInfo, position: { x: number; y: number }): void {
    this.backend.drawImage(
      image.data,
      image.format,
      position.x,
      position.y,
      image.width,
      image.height,
    );
  }

  /**
   * Render an inline (cell) image within cell bounds.
   *
   * The image is scaled to fit within the cell while preserving
   * its aspect ratio. It is centered both horizontally and vertically
   * within the cell bounds.
   *
   * @param image  Image info with raw data and original dimensions
   * @param bounds Cell bounds to fit the image within
   */
  renderInlineImage(image: ImageInfo, bounds: CellImageBounds): void {
    // Avoid division by zero
    if (image.height === 0 || bounds.height === 0 || bounds.width === 0) {
      return;
    }

    // Scale image to fit within cell, preserving aspect ratio
    const imageAspect = image.width / image.height;
    const cellAspect = bounds.width / bounds.height;

    let renderWidth: number;
    let renderHeight: number;

    if (imageAspect > cellAspect) {
      // Image is wider than cell — fit to width
      renderWidth = bounds.width;
      renderHeight = bounds.width / imageAspect;
    } else {
      // Image is taller than cell — fit to height
      renderHeight = bounds.height;
      renderWidth = bounds.height * imageAspect;
    }

    // Center the image within the cell bounds
    const x = bounds.x + (bounds.width - renderWidth) / 2;
    const y = bounds.y + (bounds.height - renderHeight) / 2;

    this.backend.drawImage(image.data, image.format, x, y, renderWidth, renderHeight);
  }

  /**
   * Render all floating images that belong to a specific page.
   *
   * Inline images are skipped here — they are handled by the cell
   * renderer, which calls renderInlineImage() directly when rendering
   * cells that contain embedded images.
   *
   * @param images           All images for the sheet
   * @param positionResolver Converts sheet anchors to page positions
   * @param pageIndex        The target page (0-indexed)
   */
  renderImages(images: ImageInfo[], positionResolver: PositionResolver, pageIndex: number): void {
    for (const image of images) {
      // Inline images are handled by the cell renderer
      if (image.isInline) continue;

      const pos = positionResolver.resolvePosition(
        image.anchor.row,
        image.anchor.col,
        image.anchor.xOffset,
        image.anchor.yOffset,
      );
      if (pos && pos.pageIndex === pageIndex) {
        this.renderFloatingImage(image, { x: pos.x, y: pos.y });
      }
    }
  }
}
