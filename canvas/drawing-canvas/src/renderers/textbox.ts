/**
 * Textbox Renderer
 *
 * Renders TextboxScene objects with support for fill, border, text wrapping,
 * vertical alignment, TextEffect delegation, rotation, and flip. Uses
 * TextMeasurer for accurate word wrapping when available.
 *
 * Pure function with error boundary: try-catch to renderErrorPlaceholder.
 *
 * @module @mog/drawing-canvas/renderers/textbox
 */

import type { TextMeasurer } from '@mog/canvas-engine';
import type { ITextEffectBridge } from '../bridges/types';
import type { HitMap } from '../hit-testing/hit-map';
import type { TextboxScene } from '../scene/types';
import { renderBorder, renderFill, withRenderContext } from './render-utils';
import { renderRichTextBlock } from './rich-text';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_PADDING = { top: 4, right: 4, bottom: 4, left: 4 };

// =============================================================================
// Textbox Renderer
// =============================================================================

/**
 * Render a TextboxScene object to the canvas.
 *
 * - If data.textEffect is set and textEffectBridge is available, delegates to
 *   the TextEffect bridge for warped text rendering.
 * - Otherwise renders fill, border, and text content with word wrapping
 *   and vertical alignment.
 * - On error: renders an error placeholder labeled "Textbox".
 */
export function renderTextbox(
  ctx: CanvasRenderingContext2D,
  obj: TextboxScene,
  textMeasurer: TextMeasurer | null,
  textEffectBridge: ITextEffectBridge | null,
  hitMap: HitMap | null,
): void {
  withRenderContext(ctx, obj, 'Textbox', () => {
    const { bounds, data } = obj;

    // Register a bounding-box Path2D for hit testing.
    // Textboxes are rectangular, so bounding box is pixel-perfect.
    if (hitMap) {
      const hitPath = new Path2D();
      hitPath.rect(bounds.x, bounds.y, bounds.width, bounds.height);
      hitMap.registerBody(obj.id, hitPath);
    }

    // TextEffect path: delegate to bridge if available
    if (data.textEffect && textEffectBridge) {
      renderTextEffectPath(ctx, obj, textEffectBridge);
      return;
    }

    // Standard rendering path
    if (data.fill) {
      renderFill(ctx, bounds, data.fill);
    }

    if (data.border) {
      renderBorder(ctx, bounds, data.border);
    }

    if (data.text) {
      renderTextContent(ctx, obj, textMeasurer);
    }
  });
}

// =============================================================================
// TextEffect Delegation
// =============================================================================

/**
 * Delegate rendering to the TextEffect bridge, with fill and border still
 * rendered by us (TextEffect only handles the text shape).
 */
function renderTextEffectPath(
  ctx: CanvasRenderingContext2D,
  obj: TextboxScene,
  textEffectBridge: ITextEffectBridge,
): void {
  const { bounds, data } = obj;
  const textEffect = data.textEffect!;

  // Render background fill and border even for TextEffect
  if (data.fill) {
    renderFill(ctx, bounds, data.fill);
  }
  if (data.border) {
    renderBorder(ctx, bounds, data.border);
  }

  // Pass full fill config including gradient data to the bridge
  const textFill = textEffect.textFill
    ? {
        type: textEffect.textFill.type,
        color: textEffect.textFill.color,
        gradient: textEffect.textFill.gradient
          ? {
              type: textEffect.textFill.gradient.type,
              angle: textEffect.textFill.gradient.angle,
              stops: textEffect.textFill.gradient.stops,
            }
          : undefined,
      }
    : undefined;

  const textOutline = textEffect.textOutline
    ? {
        style: textEffect.textOutline.style,
        color: textEffect.textOutline.color,
        width: textEffect.textOutline.width,
      }
    : undefined;

  textEffectBridge.renderTextEffect(
    data.text,
    textEffect.warpPreset,
    textEffect.warpAdjustments,
    textFill,
    textOutline,
    ctx,
    bounds,
  );
}

// =============================================================================
// Text Content Rendering
// =============================================================================

/**
 * Render text content within the textbox with padding, clipping,
 * word wrapping, and vertical alignment. Delegates to the shared
 * renderRichTextBlock utility for per-run rich text rendering.
 */
function renderTextContent(
  ctx: CanvasRenderingContext2D,
  obj: TextboxScene,
  textMeasurer: TextMeasurer | null,
): void {
  const { bounds, data } = obj;
  const padding = data.padding ?? DEFAULT_PADDING;

  const textBounds = {
    x: bounds.x + padding.left,
    y: bounds.y + padding.top,
    width: bounds.width - padding.left - padding.right,
    height: bounds.height - padding.top - padding.bottom,
  };

  renderRichTextBlock(
    ctx,
    textBounds,
    data.text,
    data.richText,
    { vertical: data.verticalAlign },
    textMeasurer,
  );
}
