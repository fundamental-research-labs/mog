/**
 * Picture Renderer
 *
 * Renders PictureScene objects with support for cropping (percentages 0-100),
 * opacity, rotation, and flip. Uses ImageCache for efficient image loading
 * and caching. Shows a placeholder while images are still loading.
 *
 * Pure function with error boundary: try-catch to renderErrorPlaceholder.
 *
 * @module @mog/drawing-canvas/renderers/picture
 */

import type { PictureScene } from '../scene/types';
import type { ImageCache } from './image-cache';
import { renderBorder, withRenderContext } from './render-utils';

// =============================================================================
// Picture Renderer
// =============================================================================

/**
 * Render a PictureScene object to the canvas.
 *
 * - If the image is cached: draws it with optional cropping, opacity,
 *   rotation, and flip transforms.
 * - If the image is still loading: renders a light gray placeholder with
 *   a camera icon outline and border.
 * - On error: renders an error placeholder labeled "Picture".
 */
export function renderPicture(
  ctx: CanvasRenderingContext2D,
  obj: PictureScene,
  imageCache: ImageCache,
): void {
  withRenderContext(ctx, obj, 'Picture', () => {
    const img = imageCache.getImage(obj.data.src);

    if (img) {
      renderImage(ctx, obj, img);
    } else {
      renderImagePlaceholder(ctx, obj.bounds);
    }

    const border = obj.data.border;
    if (border && border.style !== 'none' && border.width > 0) {
      ctx.save();
      renderBorder(ctx, obj.bounds, border);
      ctx.restore();
    }
  });
}

// =============================================================================
// Image Rendering (with cropping and opacity)
// =============================================================================

/**
 * Render the loaded image with optional cropping and opacity.
 *
 * Crop values (cropTop, cropBottom, cropLeft, cropRight) are percentages
 * in the range 0-100 representing the proportion of the source image to trim.
 */
function renderImage(
  ctx: CanvasRenderingContext2D,
  obj: PictureScene,
  img: HTMLImageElement,
): void {
  const { bounds, data } = obj;

  // Compute source rectangle with cropping
  const [cropLeft, cropRight] = normalizeCropPair(data.cropLeft, data.cropRight);
  const [cropTop, cropBottom] = normalizeCropPair(data.cropTop, data.cropBottom);

  const sx = cropLeft * img.naturalWidth;
  const sy = cropTop * img.naturalHeight;
  const sw = Math.max(1, img.naturalWidth * (1 - cropLeft - cropRight));
  const sh = Math.max(1, img.naturalHeight * (1 - cropTop - cropBottom));

  ctx.save();
  // Apply picture-specific data opacity (obj.opacity is handled by the dispatcher)
  if (data.opacity != null && data.opacity < 1) {
    ctx.globalAlpha *= Math.max(0, Math.min(1, data.opacity));
  }

  const filter = buildImageFilter(data.brightness, data.contrast);
  if (filter) {
    ctx.filter = filter;
  }

  ctx.drawImage(
    img,
    sx,
    sy,
    sw,
    sh, // Source rectangle (cropped)
    bounds.x,
    bounds.y, // Destination position
    bounds.width,
    bounds.height, // Destination size
  );
  ctx.restore();
}

function normalizeCropPair(
  startPercent: number | undefined,
  endPercent: number | undefined,
): [number, number] {
  const start = clampCropPercent(startPercent);
  const end = clampCropPercent(endPercent);
  const total = start + end;
  if (total < 0.99) return [start, end];
  return [(start / total) * 0.99, (end / total) * 0.99];
}

function clampCropPercent(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value)) / 100;
}

function buildImageFilter(brightness: number | undefined, contrast: number | undefined): string {
  const filters: string[] = [];
  if (brightness != null && Number.isFinite(brightness) && brightness !== 0) {
    filters.push(`brightness(${Math.max(0, 100 + brightness)}%)`);
  }
  if (contrast != null && Number.isFinite(contrast) && contrast !== 0) {
    filters.push(`contrast(${Math.max(0, 100 + contrast)}%)`);
  }
  return filters.join(' ');
}

// =============================================================================
// Placeholder (image still loading)
// =============================================================================

/**
 * Render a placeholder while the image is loading.
 * Shows a light gray background, border, and a simple camera icon outline.
 */
function renderImagePlaceholder(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
): void {
  // Light gray background
  ctx.fillStyle = '#f0f0f0';
  ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);

  // Border
  ctx.strokeStyle = '#cccccc';
  ctx.lineWidth = 1;
  ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);

  // Camera icon outline (centered)
  const iconSize = Math.min(bounds.width, bounds.height) * 0.3;
  if (iconSize < 4) return; // Too small to draw an icon

  const iconX = bounds.x + (bounds.width - iconSize) / 2;
  const iconY = bounds.y + (bounds.height - iconSize) / 2;

  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 2;

  // Camera body
  ctx.beginPath();
  ctx.rect(iconX, iconY + iconSize * 0.15, iconSize, iconSize * 0.7);
  // Camera top (viewfinder trapezoid)
  ctx.moveTo(iconX, iconY + iconSize * 0.15);
  ctx.lineTo(iconX + iconSize * 0.2, iconY);
  ctx.lineTo(iconX + iconSize * 0.8, iconY);
  ctx.lineTo(iconX + iconSize, iconY + iconSize * 0.15);
  ctx.stroke();

  // Lens circle
  ctx.beginPath();
  ctx.arc(iconX + iconSize / 2, iconY + iconSize * 0.5, iconSize * 0.2, 0, Math.PI * 2);
  ctx.stroke();
}
