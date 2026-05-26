/**
 * Diagram Renderer
 *
 * Renders DiagramScene objects via IDiagramRenderBridge for diagram rendering.
 * When the bridge is unavailable, renders a gray placeholder with a
 * "Diagram" label centered in the bounds.
 *
 * Pure function with error boundary: try-catch to renderErrorPlaceholder.
 *
 * @module @mog/drawing-canvas/renderers/diagram
 */

import type { IDiagramRenderBridge } from '../bridges/types';
import type { DiagramScene } from '../scene/types';
import { renderErrorPlaceholder, withRenderContext } from './render-utils';

// =============================================================================
// Diagram Renderer
// =============================================================================

/**
 * Render a DiagramScene object to the canvas.
 *
 * - If diagramBridge is available: delegates diagram rendering to the bridge.
 * - If bridge is null: renders a gray placeholder with "Diagram" label.
 * - On error: renders an error placeholder labeled "Diagram".
 */
export function renderDiagram(
  ctx: CanvasRenderingContext2D,
  obj: DiagramScene,
  diagramBridge: IDiagramRenderBridge | null,
): void {
  withRenderContext(ctx, obj, 'Diagram', () => {
    const { bounds } = obj;

    if (diagramBridge) {
      diagramBridge.renderDiagram(
        obj.data.diagramType,
        obj.data.nodes,
        ctx,
        bounds,
        obj.data.objectId,
        obj.data.quickStyleId,
        obj.data.colorThemeId,
      );
    } else {
      renderErrorPlaceholder(ctx, bounds, 'Diagram');
    }
  });
}
