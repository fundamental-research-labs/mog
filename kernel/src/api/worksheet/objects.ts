/**
 * WorksheetObjectsImpl — Implementation of the WorksheetObjects sub-API.
 *
 * Delegates to floating-object-operations, shape-operations, drawing-operations,
 * equation-operations, text-effects-operations, and diagram-operations modules.
 *
 * Floating-object-operations call ctx.computeBridge directly.
 * Other operation modules still receive the workbook's singleton SpreadsheetObjectManager.
 *
 * Operation modules throw KernelError on failure — no unwrap() needed.
 */
import type {
  CreateTextEffectInput,
  EquationConfig,
  EquationUpdates,
  FloatingObjectRemoveReceipt,
  FloatingObjectInfo,
  FloatingObjectMutationReceipt,
  PictureConfig,
  Shape,
  ShapeConfig,
  SheetId,
  StrokeTransformParams,
  TextBoxConfig,
  TextEffectUpdates,
  WorksheetObjects,
} from '@mog-sdk/contracts/api';
import type { ObjectBounds } from '@mog-sdk/contracts/kernel';
import type { FloatingObject, ObjectPosition } from '@mog-sdk/contracts/floating-objects';
import type {
  CreateDrawingOptions,
  DrawingObject,
  InkStroke,
  StrokeId,
} from '@mog-sdk/contracts/ink';
import type { TextWarpPreset } from '@mog-sdk/contracts/text-effects';

import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import type { SpreadsheetObjectManager } from '../../floating-objects';
import { toFloatingObject } from '../../bridges/compute/floating-object-mapper';
import * as DrawingOps from './operations/drawing-operations';
import * as EquationOps from './operations/equation-operations';
import * as FloatingObjectOps from './operations/floating-object-operations';
import * as ShapeOps from './operations/shape-operations';
import * as TextEffectOps from './operations/text-effects-operations';
import {
  buildFloatingObjectMutationReceipt,
  withFloatingObjectMutationReceiptBase,
  withFloatingObjectRemoveReceiptBase,
} from './objects-receipts';

export class WorksheetObjectsImpl implements WorksheetObjects {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
    private readonly manager: SpreadsheetObjectManager | null = null,
  ) {}

  /** Get the manager, throwing if not available. */
  private get mgr(): SpreadsheetObjectManager {
    if (!this.manager) {
      throw new KernelError(
        'OPERATION_FAILED',
        'FloatingObjectManager not available — WorksheetObjectsImpl created without a manager',
      );
    }
    return this.manager;
  }

  sheetIdForReceipts(): SheetId {
    return this.sheetId;
  }

  // ===========================================================================
  // Generic floating object operations (direct bridge calls via ctx)
  // ===========================================================================

  async remove(id: string): Promise<FloatingObjectRemoveReceipt> {
    const receipt = await FloatingObjectOps.deleteFloatingObject(this.ctx, this.sheetId, id);
    return withFloatingObjectRemoveReceiptBase(receipt, this.sheetId);
  }

  async move(id: string, x: number, y: number): Promise<FloatingObjectMutationReceipt> {
    const receipt = await FloatingObjectOps.moveFloatingObject(this.ctx, this.sheetId, id, x, y);
    return withFloatingObjectMutationReceiptBase(receipt, this.sheetId);
  }

  async resize(id: string, width: number, height: number): Promise<FloatingObjectMutationReceipt> {
    const receipt = await FloatingObjectOps.resizeFloatingObject(
      this.ctx,
      this.sheetId,
      id,
      width,
      height,
    );
    return withFloatingObjectMutationReceiptBase(receipt, this.sheetId);
  }

  async rotate(id: string, angle: number): Promise<void> {
    await FloatingObjectOps.rotateFloatingObject(this.ctx, this.sheetId, id, angle);
  }

  async flip(id: string, direction: 'horizontal' | 'vertical'): Promise<void> {
    await FloatingObjectOps.flipFloatingObject(this.ctx, this.sheetId, id, direction);
  }

  async duplicate(id: string): Promise<FloatingObjectMutationReceipt> {
    const receipt = await FloatingObjectOps.duplicateFloatingObject(this.ctx, this.sheetId, id);
    return withFloatingObjectMutationReceiptBase(receipt, this.sheetId);
  }

  async list(): Promise<FloatingObjectInfo[]> {
    return await FloatingObjectOps.listFloatingObjects(this.ctx, this.sheetId);
  }

  async clear(): Promise<void> {
    const items = await this.list();
    for (const item of items) {
      await this.remove(item.id);
    }
  }

  async get(objectId: string): Promise<FloatingObjectInfo | null> {
    return await FloatingObjectOps.getFloatingObject(this.ctx, this.sheetId, objectId);
  }

  async has(objectId: string): Promise<boolean> {
    return (await this.get(objectId)) !== null;
  }

  async getCount(): Promise<number> {
    return (await this.list()).length;
  }

  /**
   * Get the full domain-typed FloatingObject for an object by ID.
   * Returns the discriminated union variant (ShapeObject, PictureObject, etc.)
   * directly from the bridge, bypassing the API-level FloatingObjectInfo projection.
   */
  async getFullObject(objectId: string): Promise<FloatingObject | null> {
    const wire = await this.ctx.computeBridge.getFloatingObjectTyped(this.sheetId, objectId);
    if (!wire) return null;
    return toFloatingObject(wire);
  }

  async computeObjectBounds(objectId: string): Promise<ObjectBounds | null> {
    const allBounds = await this.ctx.computeBridge.computeAllObjectBounds(this.sheetId);
    for (const [id, bounds] of allBounds) {
      if (id === objectId) return bounds;
    }
    return null;
  }

  async computeAllObjectBounds(): Promise<Map<string, ObjectBounds>> {
    const pairs = await this.ctx.computeBridge.computeAllObjectBounds(this.sheetId);
    const map = new Map<string, ObjectBounds>();
    for (const [id, bounds] of pairs) {
      map.set(id, bounds);
    }
    return map;
  }

  async update(
    objectId: string,
    updates: Record<string, unknown>,
  ): Promise<FloatingObjectMutationReceipt> {
    await FloatingObjectOps.updateFloatingObject(this.ctx, this.sheetId, objectId, updates);
    return buildFloatingObjectMutationReceipt({
      ctx: this.ctx,
      sheetId: this.sheetId,
      objectId,
      action: 'update',
    });
  }

  async removeMany(objectIds: string[]): Promise<number> {
    return await FloatingObjectOps.deleteManyFloatingObjects(this.ctx, this.sheetId, objectIds);
  }

  // ===========================================================================
  // Z-order
  // ===========================================================================

  async bringToFront(id: string): Promise<void> {
    await FloatingObjectOps.bringToFront(this.ctx, this.sheetId, id);
  }

  async sendToBack(id: string): Promise<void> {
    await FloatingObjectOps.sendToBack(this.ctx, this.sheetId, id);
  }

  async bringForward(id: string): Promise<void> {
    await FloatingObjectOps.bringForward(this.ctx, this.sheetId, id);
  }

  async sendBackward(id: string): Promise<void> {
    await FloatingObjectOps.sendBackward(this.ctx, this.sheetId, id);
  }

  // ===========================================================================
  // Grouping
  // ===========================================================================

  async group(ids: string[]): Promise<string> {
    return await FloatingObjectOps.groupFloatingObjects(this.ctx, this.sheetId, ids);
  }

  async ungroup(groupId: string): Promise<void> {
    await FloatingObjectOps.ungroupFloatingObjects(this.ctx, this.sheetId, groupId);
  }

  // ===========================================================================
  // Shapes
  // ===========================================================================

  async addShape(config: ShapeConfig): Promise<FloatingObjectMutationReceipt> {
    const receipt = await ShapeOps.createShape(this.ctx, this.sheetId, config);
    return withFloatingObjectMutationReceiptBase(receipt, this.sheetId);
  }

  async getShape(shapeId: string): Promise<Shape | null> {
    return (await ShapeOps.getShape(this.mgr, this.ctx, this.sheetId, shapeId)) ?? null;
  }

  async updateShape(
    shapeId: string,
    updates: Partial<ShapeConfig>,
  ): Promise<FloatingObjectMutationReceipt> {
    const receipt = await ShapeOps.updateShape(this.ctx, this.sheetId, shapeId, updates);
    return withFloatingObjectMutationReceiptBase(receipt, this.sheetId);
  }

  async listShapes(): Promise<Shape[]> {
    return await ShapeOps.getShapes(this.mgr, this.ctx, this.sheetId);
  }

  // ===========================================================================
  // Pictures
  // ===========================================================================

  async addPicture(config: PictureConfig): Promise<FloatingObjectMutationReceipt> {
    const receipt = await FloatingObjectOps.addPicture(this.ctx, this.sheetId, config);
    return withFloatingObjectMutationReceiptBase(receipt, this.sheetId);
  }

  async updatePicture(
    id: string,
    updates: Partial<PictureConfig>,
  ): Promise<FloatingObjectMutationReceipt> {
    await FloatingObjectOps.updatePicture(this.ctx, this.sheetId, id, updates);
    return buildFloatingObjectMutationReceipt({
      ctx: this.ctx,
      sheetId: this.sheetId,
      objectId: id,
      action: 'update',
      fallbackType: 'picture',
    });
  }

  // ===========================================================================
  // Text boxes
  // ===========================================================================

  async addTextBox(config: TextBoxConfig): Promise<FloatingObjectMutationReceipt> {
    const receipt = await FloatingObjectOps.addTextBox(this.ctx, this.sheetId, config);
    return withFloatingObjectMutationReceiptBase(receipt, this.sheetId);
  }

  // ===========================================================================
  // Equations
  // ===========================================================================

  async addEquation(config: EquationConfig): Promise<FloatingObjectMutationReceipt> {
    const id = await EquationOps.createEquation(this.mgr, this.ctx, this.sheetId, config);
    return buildFloatingObjectMutationReceipt({
      ctx: this.ctx,
      sheetId: this.sheetId,
      objectId: id,
      action: 'create',
      fallbackType: 'equation',
    });
  }

  async updateEquation(
    id: string,
    updates: EquationUpdates,
  ): Promise<FloatingObjectMutationReceipt> {
    await EquationOps.updateEquation(this.mgr, this.ctx, this.sheetId, id, updates);
    return buildFloatingObjectMutationReceipt({
      ctx: this.ctx,
      sheetId: this.sheetId,
      objectId: id,
      action: 'update',
      fallbackType: 'equation',
    });
  }

  // ===========================================================================
  // TextEffect
  // ===========================================================================

  async addTextEffect(config: CreateTextEffectInput): Promise<FloatingObjectMutationReceipt> {
    const id = await TextEffectOps.createTextEffect(this.mgr, this.ctx, this.sheetId, config);
    return buildFloatingObjectMutationReceipt({
      ctx: this.ctx,
      sheetId: this.sheetId,
      objectId: id,
      action: 'create',
      fallbackType: 'textbox',
    });
  }

  async updateTextEffect(
    id: string,
    updates: TextEffectUpdates,
  ): Promise<FloatingObjectMutationReceipt> {
    await TextEffectOps.updateTextEffect(this.mgr, this.ctx, this.sheetId, id, updates);
    return buildFloatingObjectMutationReceipt({
      ctx: this.ctx,
      sheetId: this.sheetId,
      objectId: id,
      action: 'update',
      fallbackType: 'textbox',
    });
  }

  async convertToTextEffect(objectId: string, warpPreset?: TextWarpPreset): Promise<void> {
    await TextEffectOps.convertToTextEffect(this.mgr, this.ctx, this.sheetId, objectId, warpPreset);
  }

  async convertToTextBox(objectId: string): Promise<void> {
    await TextEffectOps.convertToTextBox(this.mgr, this.ctx, this.sheetId, objectId);
  }

  // ===========================================================================
  // Connector Connections
  // ===========================================================================

  async connectBeginShape(
    connectorId: string,
    targetShapeId: string,
    siteIndex: number,
  ): Promise<void> {
    await FloatingObjectOps.connectBeginShape(
      this.ctx,
      this.sheetId,
      connectorId,
      targetShapeId,
      siteIndex,
    );
  }

  async connectEndShape(
    connectorId: string,
    targetShapeId: string,
    siteIndex: number,
  ): Promise<void> {
    await FloatingObjectOps.connectEndShape(
      this.ctx,
      this.sheetId,
      connectorId,
      targetShapeId,
      siteIndex,
    );
  }

  async disconnectBeginShape(connectorId: string): Promise<void> {
    await FloatingObjectOps.disconnectBeginShape(this.ctx, this.sheetId, connectorId);
  }

  async disconnectEndShape(connectorId: string): Promise<void> {
    await FloatingObjectOps.disconnectEndShape(this.ctx, this.sheetId, connectorId);
  }

  async getConnectorData(connectorId: string): Promise<{
    startConnection?: { shapeId: string; siteIndex: number };
    endConnection?: { shapeId: string; siteIndex: number };
  } | null> {
    return await FloatingObjectOps.getConnectorData(this.ctx, this.sheetId, connectorId);
  }

  // ===========================================================================
  // Group Queries
  // ===========================================================================

  async getGroupMembers(groupId: string): Promise<string[]> {
    return await FloatingObjectOps.getGroupMembers(this.ctx, this.sheetId, groupId);
  }

  // ===========================================================================
  // Image Queries
  // ===========================================================================

  async getImageFormat(objectId: string): Promise<string | null> {
    return await FloatingObjectOps.getImageFormat(this.ctx, this.sheetId, objectId);
  }

  async getConnectionSiteCount(objectId: string): Promise<number> {
    return await FloatingObjectOps.getConnectionSiteCount(this.ctx, this.sheetId, objectId);
  }

  // ===========================================================================
  // Drawings (ink)
  // ===========================================================================

  async createDrawing(
    position: Partial<ObjectPosition>,
    options?: CreateDrawingOptions,
  ): Promise<FloatingObjectMutationReceipt> {
    const id = await DrawingOps.createDrawing(this.mgr, this.ctx, this.sheetId, position, options);
    return buildFloatingObjectMutationReceipt({
      ctx: this.ctx,
      sheetId: this.sheetId,
      objectId: id,
      action: 'create',
      fallbackType: 'drawing',
    });
  }

  async addDrawingStroke(drawingId: string, stroke: InkStroke): Promise<void> {
    await DrawingOps.addDrawingStroke(this.mgr, this.ctx, this.sheetId, drawingId, stroke);
  }

  async eraseDrawingStrokes(drawingId: string, strokeIds: StrokeId[]): Promise<void> {
    await DrawingOps.eraseDrawingStrokes(this.mgr, this.ctx, this.sheetId, drawingId, strokeIds);
  }

  async clearDrawingStrokes(drawingId: string): Promise<void> {
    await DrawingOps.clearDrawingStrokes(this.mgr, this.ctx, this.sheetId, drawingId);
  }

  async moveDrawingStrokes(
    drawingId: string,
    strokeIds: StrokeId[],
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await DrawingOps.moveDrawingStrokes(
      this.mgr,
      this.ctx,
      this.sheetId,
      drawingId,
      strokeIds,
      deltaX,
      deltaY,
    );
  }

  async transformDrawingStrokes(
    drawingId: string,
    strokeIds: StrokeId[],
    transform: StrokeTransformParams,
  ): Promise<void> {
    await DrawingOps.transformDrawingStrokes(
      this.mgr,
      this.ctx,
      this.sheetId,
      drawingId,
      strokeIds,
      transform,
    );
  }

  async getDrawing(drawingId: string): Promise<DrawingObject | null> {
    return await DrawingOps.queryDrawingObject(this.mgr, drawingId);
  }

  async findStrokesAtPoint(
    drawingId: string,
    x: number,
    y: number,
    tolerance?: number,
  ): Promise<StrokeId[]> {
    return await DrawingOps.queryStrokesAtPoint(this.mgr, drawingId, x, y, tolerance);
  }
}
