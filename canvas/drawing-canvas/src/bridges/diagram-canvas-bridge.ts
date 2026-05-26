/**
 * Diagram Canvas Bridge
 *
 * Concrete adapter that bridges the kernel DiagramBridge (15+ methods for
 * diagram management) to the canvas-side IDiagramRenderBridge (single
 * renderDiagram method). This replaces the gray placeholder with actual
 * diagram rendering.
 *
 * Rendering strategy:
 * 1. Attempt to get ComputedLayout from the kernel bridge (cached layout)
 * 2. If available, render shapes and connectors from the layout
 * 3. If unavailable, fall back to a basic node-based layout
 *
 * @module @mog/drawing-canvas/bridges/diagram-engine-canvas-bridge
 */

import type { Rect } from '@mog/canvas-engine';
import type { IDiagramBridge as IDiagramKernelBridge } from '@mog-sdk/contracts/bridges';
import type { ComputedConnector, ComputedLayout, ComputedShape } from '@mog-sdk/contracts/diagram';

import { lightenColor } from '@mog/diagram-engine';

import { drawArrowHead } from '../renderers/connector';
import { renderPlaceholder } from '../renderers/render-utils';
import type { IDiagramRenderBridge } from './types';

// =============================================================================
// Constants
// =============================================================================

/** Default shape fill color (Excel accent blue) */
const DEFAULT_FILL = '#4472C4';

/** Default shape stroke color (darker accent blue) */
const DEFAULT_STROKE = '#2F528F';

/** Default text color */
const DEFAULT_TEXT_COLOR = '#FFFFFF';

/** Default connector stroke color */
const DEFAULT_CONNECTOR_STROKE = '#404040';

/** Default connector stroke width */
const DEFAULT_CONNECTOR_WIDTH = 1.5;

/** Corner radius for rounded rectangles */
const CORNER_RADIUS = 6;

/** Padding between node slots */
const SLOT_PADDING = 8;

/** Internal padding within each shape */
const SHAPE_PADDING = 8;

/** Font used for node text */
const TEXT_FONT = '12px Segoe UI, Calibri, Arial, sans-serif';

/** Font used for small/overflow text */
const SMALL_TEXT_FONT = '10px Segoe UI, Calibri, Arial, sans-serif';

// =============================================================================
// DiagramCanvasBridge
// =============================================================================

export class DiagramCanvasBridge implements IDiagramRenderBridge {
  /**
   * Kernel bridge used for layout lookup. May be null if not yet wired.
   */
  private kernelBridge: IDiagramKernelBridge | null;

  /**
   * Cache of last rendered layout per objectId to avoid async blocking.
   * The kernel bridge's getComputedLayout may return a Promise, so we
   * cache the last successful result for synchronous rendering.
   */
  private layoutCache = new Map<string, ComputedLayout>();

  constructor(kernelBridge: IDiagramKernelBridge | null = null) {
    this.kernelBridge = kernelBridge;
  }

  /**
   * Update the kernel bridge reference (e.g., after lazy initialization).
   */
  setKernelBridge(bridge: IDiagramKernelBridge): void {
    this.kernelBridge = bridge;
  }

  // ===========================================================================
  // IDiagramRenderBridge Implementation
  // ===========================================================================

  renderDiagram(
    _diagramType: string,
    nodes: ReadonlyArray<{ id: string; text: string; level: number }>,
    ctx: CanvasRenderingContext2D,
    bounds: Rect,
    objectId?: string,
    quickStyleId?: string,
    _colorThemeId?: string,
  ): void {
    // Try to use cached layout from kernel bridge
    if (objectId && this.kernelBridge) {
      const cached = this.layoutCache.get(objectId);
      if (cached) {
        this.renderFromLayout(cached, ctx, bounds);
        return;
      }

      // Trigger async layout fetch for next frame
      this.fetchLayoutAsync(objectId);
    }

    // Fallback: render basic layout from nodes array
    this.renderFallbackLayout(nodes, ctx, bounds, quickStyleId);
  }

  // ===========================================================================
  // Async Layout Fetching
  // ===========================================================================

  /**
   * Fetch layout from kernel bridge asynchronously.
   * The result is cached for the next render frame.
   */
  private fetchLayoutAsync(objectId: string): void {
    if (!this.kernelBridge) return;

    const result = this.kernelBridge.getComputedLayout(objectId);

    // Handle both sync and async returns
    if (result && typeof (result as Promise<unknown>).then === 'function') {
      (result as Promise<ComputedLayout | undefined>).then((layout) => {
        if (layout) {
          this.layoutCache.set(objectId, layout);
        }
      });
    } else if (result) {
      this.layoutCache.set(objectId, result as ComputedLayout);
    }
  }

  /**
   * Invalidate the cached layout for a specific object.
   * Called when the diagram structure or styling changes.
   */
  invalidateLayout(objectId: string): void {
    this.layoutCache.delete(objectId);
  }

  /**
   * Invalidate all cached layouts.
   */
  invalidateAllLayouts(): void {
    this.layoutCache.clear();
  }

  // ===========================================================================
  // Rendering from ComputedLayout (kernel bridge path)
  // ===========================================================================

  private renderFromLayout(
    layout: ComputedLayout,
    ctx: CanvasRenderingContext2D,
    bounds: Rect,
  ): void {
    // Compute scale to fit the layout within the target bounds
    const scaleX = layout.bounds.width > 0 ? bounds.width / layout.bounds.width : 1;
    const scaleY = layout.bounds.height > 0 ? bounds.height / layout.bounds.height : 1;
    const scale = Math.min(scaleX, scaleY);

    // Center the layout within bounds
    const offsetX = bounds.x + (bounds.width - layout.bounds.width * scale) / 2;
    const offsetY = bounds.y + (bounds.height - layout.bounds.height * scale) / 2;

    ctx.save();

    // Render connectors first (behind shapes)
    for (const connector of layout.connectors) {
      this.renderConnector(connector, ctx, offsetX, offsetY, scale);
    }

    // Render shapes on top
    for (const shape of layout.shapes) {
      this.renderShape(shape, ctx, offsetX, offsetY, scale);
    }

    ctx.restore();
  }

  // ===========================================================================
  // Shape Rendering
  // ===========================================================================

  private renderShape(
    shape: ComputedShape,
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    scale: number,
  ): void {
    const x = offsetX + shape.x * scale;
    const y = offsetY + shape.y * scale;
    const w = shape.width * scale;
    const h = shape.height * scale;
    const r = Math.min(CORNER_RADIUS, w / 4, h / 4);

    ctx.save();

    // Apply rotation if any
    if (shape.rotation) {
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.translate(cx, cy);
      ctx.rotate((shape.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    // Draw shape based on type
    ctx.beginPath();
    if (shape.shapeType === 'ellipse') {
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    } else {
      ctx.roundRect(x, y, w, h, r);
    }

    // Fill
    ctx.fillStyle = shape.fill || DEFAULT_FILL;
    ctx.fill();

    // Stroke
    if (shape.strokeWidth > 0) {
      ctx.strokeStyle = shape.stroke || DEFAULT_STROKE;
      ctx.lineWidth = shape.strokeWidth * scale;
      ctx.stroke();
    }

    // Text
    if (shape.text) {
      const textStyle = shape.textStyle;
      const fontSize = Math.max(8, (textStyle?.fontSize ?? 12) * scale);
      const fontFamily = textStyle?.fontFamily ?? 'Segoe UI, Calibri, Arial, sans-serif';
      const fontWeight = textStyle?.fontWeight === 'bold' ? 'bold' : 'normal';
      ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
      ctx.fillStyle = textStyle?.color ?? DEFAULT_TEXT_COLOR;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Clip text to shape bounds
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + SHAPE_PADDING, y, w - 2 * SHAPE_PADDING, h, 0);
      ctx.clip();
      ctx.fillText(shape.text, x + w / 2, y + h / 2);
      ctx.restore();
    }

    ctx.restore();
  }

  // ===========================================================================
  // Connector Rendering
  // ===========================================================================

  private renderConnector(
    connector: ComputedConnector,
    ctx: CanvasRenderingContext2D,
    offsetX: number,
    offsetY: number,
    scale: number,
  ): void {
    const { path } = connector;
    if (!path || path.points.length < 2) return;

    ctx.save();
    ctx.strokeStyle = connector.stroke || DEFAULT_CONNECTOR_STROKE;
    ctx.lineWidth = (connector.strokeWidth || DEFAULT_CONNECTOR_WIDTH) * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();

    const p0 = path.points[0];
    ctx.moveTo(offsetX + p0.x * scale, offsetY + p0.y * scale);

    if (path.type === 'bezier' && path.controlPoints && path.controlPoints.length >= 2) {
      // Bezier curve
      const cp1 = path.controlPoints[0];
      const cp2 = path.controlPoints[1];
      const pEnd = path.points[path.points.length - 1];
      ctx.bezierCurveTo(
        offsetX + cp1.x * scale,
        offsetY + cp1.y * scale,
        offsetX + cp2.x * scale,
        offsetY + cp2.y * scale,
        offsetX + pEnd.x * scale,
        offsetY + pEnd.y * scale,
      );
    } else {
      // Line or polyline
      for (let i = 1; i < path.points.length; i++) {
        const pt = path.points[i];
        ctx.lineTo(offsetX + pt.x * scale, offsetY + pt.y * scale);
      }
    }

    ctx.stroke();

    // Draw arrow end if present — delegates to the shared drawArrowHead
    if (connector.arrowEnd && connector.arrowEnd.type !== 'none') {
      const lastPt = path.points[path.points.length - 1];
      const prevPt = path.points[path.points.length - 2] ?? path.points[0];
      const toX = offsetX + lastPt.x * scale;
      const toY = offsetY + lastPt.y * scale;
      const fromX = offsetX + prevPt.x * scale;
      const fromY = offsetY + prevPt.y * scale;
      const angle = Math.atan2(toY - fromY, toX - fromX);

      // Map Diagram 'open' type to connector 'arrow' type
      const endType = connector.arrowEnd.type === 'open' ? 'arrow' : connector.arrowEnd.type;
      const sizeMap = { small: 'sm', medium: 'med', large: 'lg' } as const;
      const size = sizeMap[connector.arrowEnd.size] ?? undefined;

      ctx.fillStyle = ctx.strokeStyle as string;
      drawArrowHead(ctx, toX, toY, angle, endType, size, size);
    }

    ctx.restore();
  }

  // ===========================================================================
  // Fallback Layout (no kernel bridge data)
  // ===========================================================================

  /**
   * Render a basic layout from the nodes array when kernel bridge data
   * is unavailable. Divides bounds into equal-sized slots arranged
   * horizontally, with connector lines between adjacent nodes.
   */
  private renderFallbackLayout(
    nodes: ReadonlyArray<{ id: string; text: string; level: number }>,
    ctx: CanvasRenderingContext2D,
    bounds: Rect,
    _quickStyleId?: string,
  ): void {
    if (nodes.length === 0) {
      renderPlaceholder(ctx, bounds, 'Diagram', {
        stroke: '#C0C0C0',
        textColor: '#808080',
        font: '11px Segoe UI, Calibri, Arial, sans-serif',
        cornerRadius: 4,
      });
      return;
    }

    ctx.save();

    // Compute slot dimensions
    const nodeCount = nodes.length;
    const totalPadding = SLOT_PADDING * (nodeCount + 1);
    const availableWidth = bounds.width - totalPadding;
    const slotWidth = Math.max(40, availableWidth / nodeCount);
    const slotHeight = Math.max(30, bounds.height - SLOT_PADDING * 2);

    // Compute shape rects
    const shapes: Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      text: string;
      level: number;
    }> = [];
    for (let i = 0; i < nodeCount; i++) {
      const node = nodes[i];
      const x = bounds.x + SLOT_PADDING + i * (slotWidth + SLOT_PADDING);
      const y = bounds.y + SLOT_PADDING;
      shapes.push({
        x,
        y,
        w: slotWidth,
        h: slotHeight,
        text: node.text,
        level: node.level,
      });
    }

    // Draw connector lines between adjacent nodes
    ctx.strokeStyle = DEFAULT_CONNECTOR_STROKE;
    ctx.lineWidth = DEFAULT_CONNECTOR_WIDTH;
    ctx.lineCap = 'round';
    for (let i = 0; i < shapes.length - 1; i++) {
      const from = shapes[i];
      const to = shapes[i + 1];
      const fromX = from.x + from.w;
      const fromY = from.y + from.h / 2;
      const toX = to.x;
      const toY = to.y + to.h / 2;

      ctx.beginPath();
      ctx.moveTo(fromX, fromY);
      ctx.lineTo(toX, toY);
      ctx.stroke();

      // Simple arrow head — delegate to shared drawArrowHead
      const angle = Math.atan2(toY - fromY, toX - fromX);
      ctx.fillStyle = ctx.strokeStyle as string;
      drawArrowHead(ctx, toX, toY, angle, 'triangle', undefined, undefined);
    }

    // Draw shapes
    for (const shape of shapes) {
      const r = Math.min(CORNER_RADIUS, shape.w / 4, shape.h / 4);

      ctx.beginPath();
      ctx.roundRect(shape.x, shape.y, shape.w, shape.h, r);

      // Deeper levels get lighter fills
      const lightness = Math.min(shape.level * 10, 30);
      ctx.fillStyle = lightness > 0 ? lightenColor(DEFAULT_FILL, lightness / 100) : DEFAULT_FILL;
      ctx.fill();

      ctx.strokeStyle = DEFAULT_STROKE;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Text
      if (shape.text) {
        const maxFontSize = Math.min(12, shape.h / 3);
        ctx.font = shape.w < 60 ? SMALL_TEXT_FONT : TEXT_FONT;
        if (maxFontSize < 10) {
          ctx.font = `${maxFontSize}px Segoe UI, Calibri, Arial, sans-serif`;
        }
        ctx.fillStyle = DEFAULT_TEXT_COLOR;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // Clip text
        ctx.save();
        ctx.beginPath();
        ctx.rect(shape.x + 2, shape.y + 2, shape.w - 4, shape.h - 4);
        ctx.clip();
        ctx.fillText(shape.text, shape.x + shape.w / 2, shape.y + shape.h / 2);
        ctx.restore();
      }
    }

    ctx.restore();
  }
}
