/**
 * Rendering Dispatcher
 *
 * Routes SceneObject instances to the correct renderer based on the `type`
 * discriminant. Uses an exhaustive switch with a `default: never` guard to
 * ensure compile-time coverage of all scene object types.
 *
 * Each render call is wrapped in a try-catch so a single broken object
 * never kills the entire drawing layer.
 *
 * @module @mog/drawing-canvas/renderers/dispatcher
 */

import type { TextMeasurer } from '@mog/canvas-engine';
import type { BridgeRegistry } from '../bridges/bridge-registry';
import type { HitMap } from '../hit-testing/hit-map';
import type { SceneObject } from '../scene/types';
import { renderChart } from './chart';
import { renderConnector } from './connector';
import { renderEquation } from './equation';
import type { ImageCache } from './image-cache';
import { renderInk } from './ink';
import { renderOleObject } from './ole-object';
import { renderPicture } from './picture';
import { renderErrorPlaceholder } from './render-utils';
import { renderShape } from './shape';
import { renderDiagram } from './diagram';
import { renderTextbox } from './textbox';

// =============================================================================
// Rendering Dispatcher
// =============================================================================

/**
 * Dispatch a SceneObject to the appropriate renderer.
 *
 * - Skips invisible objects.
 * - Applies global opacity when < 1.
 * - Exhaustive switch on obj.type ensures every scene type is handled.
 * - Each case is wrapped in try-catch: on failure, renders an error
 *   placeholder so one broken object cannot crash the layer.
 */
export function dispatchRender(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  bridges: BridgeRegistry,
  imageCache: ImageCache,
  textMeasurer: TextMeasurer | null,
  hitMap?: HitMap | null,
): void {
  // Skip invisible objects
  if (!obj.visible) return;

  // Apply global opacity
  const hasOpacity = obj.opacity !== undefined && obj.opacity < 1;
  if (hasOpacity) {
    ctx.save();
    ctx.globalAlpha = obj.opacity!;
  }

  try {
    switch (obj.type) {
      case 'picture':
        renderPicture(ctx, obj, imageCache);
        break;

      case 'textbox':
        renderTextbox(ctx, obj, textMeasurer, bridges.getTextEffectBridge(), hitMap ?? null);
        break;

      case 'shape':
        renderShape(ctx, obj, hitMap ?? null, textMeasurer);
        break;

      case 'connector':
        renderConnector(ctx, obj, hitMap ?? null);
        break;

      case 'chart':
        if (!bridges.hasChartBridge()) break;
        renderChart(ctx, obj, bridges.getChartBridge());
        break;

      case 'ink':
        renderInk(ctx, obj);
        break;

      case 'equation':
        renderEquation(ctx, obj, bridges.getAstToLatexFn());
        break;

      case 'diagram':
        renderDiagram(ctx, obj, bridges.getDiagramBridge());
        break;

      case 'oleObject':
        renderOleObject(ctx, obj, imageCache);
        break;

      default: {
        const _exhaustive: never = obj;
        throw new Error(`Unhandled scene object type: ${(_exhaustive as SceneObject).type}`);
      }
    }
  } catch (err) {
    renderErrorPlaceholder(ctx, obj.bounds, obj.type);
  }

  // Restore ctx if opacity was applied
  if (hasOpacity) {
    ctx.restore();
  }
}
