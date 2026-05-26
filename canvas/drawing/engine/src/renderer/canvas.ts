/**
 * Canvas2D rendering orchestrator.
 *
 * Composes path, fill, stroke, and effect primitives to render
 * a complete DrawingObject to a Canvas2D context.
 *
 * Rendering order:
 * 1. save + apply transform
 * 2. Clip (if present)
 * 3. Pre-fill effects: outer shadows
 * 4. Fill
 * 5. Post-fill effects: inner shadows
 * 6. Stroke
 * 7. Post-stroke effects: glow, bevel, soft edge
 * 8. Text (placeholder -- text layout is complex, deferred)
 * 9. Children: recurse for groups / TextEffect glyphs / Diagram nodes
 * 10. restore
 */
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import {
  render3DBevelToCanvas,
  renderBevelToCanvas,
  renderExtrusionToCanvas,
  renderGlowToCanvas,
  renderInnerShadowToCanvas,
  renderMaterialToCanvas,
  renderOuterShadowToCanvas,
  renderSoftEdgeToCanvas,
} from './effects/canvas';
import { renderFillToCanvas } from './fills';
import { replayPathToCanvas } from './path';
import { renderStrokeToCanvas } from './strokes';

/**
 * Render a DrawingObject to a Canvas2D context.
 *
 * Handles the full rendering pipeline: transforms, clipping, effects,
 * fill, stroke, and recursive child rendering. Each call is wrapped
 * in save/restore to isolate state changes.
 */
export function renderDrawingObjectToCanvas(
  obj: DrawingObject,
  ctx: CanvasRenderingContext2D,
): void {
  ctx.save();

  // 1. Apply transform
  if (obj.transform) {
    const t = obj.transform;
    ctx.transform(t.a, t.b, t.c, t.d, t.tx, t.ty);
  }

  // Apply clip if present
  if (obj.clip) {
    ctx.beginPath();
    replayPathToCanvas(obj.clip, ctx);
    ctx.clip();
  }

  // 2. Pre-fill effects: outer shadows
  if (obj.effects?.outerShadow) {
    for (const shadow of obj.effects.outerShadow) {
      renderOuterShadowToCanvas(shadow, obj.geometry, ctx, replayPathToCanvas);
    }
  }

  // 2b. Pre-fill 3D extrusion (depth layers behind the shape)
  if (obj.sp3d?.extrusionH) {
    const extColor = obj.sp3d.extrusionClr?.val ?? '#666666';
    renderExtrusionToCanvas(obj.sp3d.extrusionH, extColor, obj.geometry, ctx, replayPathToCanvas);
  }

  // 3. Fill
  if (obj.fill) {
    renderFillToCanvas(obj.fill, obj.geometry, ctx);
  }

  // 4. Post-fill effects: inner shadows
  if (obj.effects?.innerShadow) {
    for (const shadow of obj.effects.innerShadow) {
      renderInnerShadowToCanvas(shadow, obj.geometry, ctx, replayPathToCanvas);
    }
  }

  // 5. Stroke
  if (obj.stroke) {
    renderStrokeToCanvas(obj.stroke, obj.geometry, ctx);
  }

  // 6. Post-stroke effects: glow, bevel, soft edge
  if (obj.effects?.glow) {
    renderGlowToCanvas(obj.effects.glow, obj.geometry, ctx, replayPathToCanvas);
  }

  if (obj.effects?.bevel) {
    renderBevelToCanvas(obj.effects.bevel, obj.geometry, ctx, replayPathToCanvas);
  }

  if (obj.effects?.softEdge) {
    renderSoftEdgeToCanvas(obj.effects.softEdge, obj.geometry, ctx, replayPathToCanvas);
  }

  // 6b. Post-stroke 3D effects: bevels and material (OOXML sp3d properties)
  if (obj.sp3d) {
    if (obj.sp3d.bevelT) {
      render3DBevelToCanvas(obj.sp3d.bevelT, 'top', obj.geometry, ctx, replayPathToCanvas);
    }
    if (obj.sp3d.bevelB) {
      render3DBevelToCanvas(obj.sp3d.bevelB, 'bottom', obj.geometry, ctx, replayPathToCanvas);
    }
    if (obj.sp3d.prstMaterial) {
      renderMaterialToCanvas(obj.sp3d.prstMaterial, obj.geometry, ctx, replayPathToCanvas);
    }
  }

  // Reflection rendering is deferred -- DrawingEffects.reflection is defined
  // but the Canvas2D approximation requires off-screen buffer compositing
  // that is not yet implemented.

  // 7. Text rendering (placeholder -- complex text layout deferred)
  // if (obj.text) { renderText(obj.text, obj.geometry, ctx); }

  // 8. Children (groups, TextEffect glyphs, Diagram nodes)
  if (obj.children) {
    for (const child of obj.children) {
      renderDrawingObjectToCanvas(child, ctx);
    }
  }

  ctx.restore();
}
