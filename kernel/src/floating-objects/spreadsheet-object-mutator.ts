/**
 * Spreadsheet Object Mutator
 *
 * Implements IObjectMutator by delegating spatial operations to the Rust
 * ComputeBridge. Each method resolves the containerId (sheetId) from the
 * object store, then calls the corresponding typed bridge method.
 *
 * This is kernel-internal — apps never receive or call it directly.
 * All app-layer writes go through ws.objects.* (Worksheet Objects API).
 */

import type { IObjectMutator } from '@mog-sdk/contracts/objects/object-mutator';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ComputeBridge } from '../bridges/compute/compute-bridge';
import type { ComputeBridgeObjectStore } from './object-store';

export class SpreadsheetObjectMutator implements IObjectMutator {
  constructor(
    private computeBridge: ComputeBridge,
    private objectStore: ComputeBridgeObjectStore,
  ) {}

  private async getContainerId(objectId: string): Promise<SheetId | null> {
    const found = await this.objectStore.read(objectId);
    return found.containerId ? toSheetId(found.containerId) : null;
  }

  async move(objectId: string, dx: number, dy: number): Promise<boolean> {
    const sheetId = await this.getContainerId(objectId);
    if (!sheetId) return false;
    const result = await this.computeBridge.moveFloatingObjectTyped(sheetId, objectId, {
      type: 'delta',
      dx,
      dy,
    });
    return !!result;
  }

  async resize(objectId: string, width: number, height: number): Promise<boolean> {
    const sheetId = await this.getContainerId(objectId);
    if (!sheetId) return false;
    const result = await this.computeBridge.resizeFloatingObjectTyped(sheetId, objectId, {
      width,
      height,
    });
    return !!result;
  }

  async rotate(objectId: string, angle: number): Promise<boolean> {
    const sheetId = await this.getContainerId(objectId);
    if (!sheetId) return false;
    const result = await this.computeBridge.rotateFloatingObjectTyped(sheetId, objectId, angle);
    return !!result;
  }

  async flip(objectId: string, axis: 'horizontal' | 'vertical'): Promise<boolean> {
    const sheetId = await this.getContainerId(objectId);
    if (!sheetId) return false;
    const result = await this.computeBridge.flipFloatingObjectTyped(sheetId, objectId, axis);
    return !!result;
  }

  async duplicate(objectId: string, offsetX: number, offsetY: number): Promise<string | null> {
    const sheetId = await this.getContainerId(objectId);
    if (!sheetId) return null;
    const result = await this.computeBridge.duplicateFloatingObjectTyped(
      sheetId,
      objectId,
      offsetX,
      offsetY,
    );
    // Find the newly created object in the mutation result
    const created = result?.floatingObjectChanges?.find((c) => c.kind.type === 'created');
    return created?.objectId ?? null;
  }

  async delete(objectId: string): Promise<boolean> {
    const sheetId = await this.getContainerId(objectId);
    if (!sheetId) return false;
    const result = await this.computeBridge.deleteFloatingObject(sheetId, objectId);
    return !!result;
  }

  async deleteMany(objectIds: string[]): Promise<number> {
    let count = 0;
    for (const id of objectIds) {
      if (await this.delete(id)) count++;
    }
    return count;
  }

  async bringToFront(objectId: string): Promise<boolean> {
    const sheetId = await this.getContainerId(objectId);
    if (!sheetId) return false;
    const result = await this.computeBridge.bringFloatingObjectToFront(sheetId, objectId);
    return !!result;
  }

  async sendToBack(objectId: string): Promise<boolean> {
    const sheetId = await this.getContainerId(objectId);
    if (!sheetId) return false;
    const result = await this.computeBridge.sendFloatingObjectToBack(sheetId, objectId);
    return !!result;
  }

  async bringForward(objectId: string): Promise<boolean> {
    const sheetId = await this.getContainerId(objectId);
    if (!sheetId) return false;
    const result = await this.computeBridge.bringFloatingObjectForward(sheetId, objectId);
    return !!result;
  }

  async sendBackward(objectId: string): Promise<boolean> {
    const sheetId = await this.getContainerId(objectId);
    if (!sheetId) return false;
    const result = await this.computeBridge.sendFloatingObjectBackward(sheetId, objectId);
    return !!result;
  }
}
