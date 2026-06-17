/**
 * WorksheetObjectCollectionImpl — universal floating object collection.
 *
 * Returns the correct handle subtype based on the object's FloatingObjectInfo.type.
 */
import type {
  FloatingObjectHandle,
  FloatingObjectInfo,
  FloatingObjectType,
  FloatingObjectMutationReceipt,
  WorksheetObjectCollection,
} from '@mog-sdk/contracts/api';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects/object-bounds-reader';
import type { ObjectBounds } from '@mog-sdk/contracts/kernel';
import type { FloatingObject } from '@mog-sdk/contracts/floating-objects';
import type { TextWarpPreset } from '@mog-sdk/contracts/text-effects';

import type { WorksheetObjectsImpl } from '../objects';
import { createFloatingObjectHandle } from '../handles/floating-object-handle-factory';

export class WorksheetObjectCollectionImpl implements WorksheetObjectCollection {
  constructor(
    private readonly objectsImpl: WorksheetObjectsImpl,
    private readonly boundsReader: IObjectBoundsReader | null,
  ) {}

  async get(id: string): Promise<FloatingObjectHandle | null> {
    const info = await this.objectsImpl.get(id);
    if (!info) return null;
    return this.createHandle(info.id, info.type);
  }

  async getInfo(id: string): Promise<FloatingObjectInfo | null> {
    return this.objectsImpl.get(id);
  }

  async getFullObject(id: string): Promise<FloatingObject | null> {
    return this.objectsImpl.getFullObject(id);
  }

  async list(): Promise<FloatingObjectHandle[]> {
    const infos = await this.objectsImpl.list();
    return infos.map((info) => this.createHandle(info.id, info.type));
  }

  async removeMany(ids: string[]): Promise<number> {
    return this.objectsImpl.removeMany(ids);
  }

  // ── Single-ID convenience methods ──────────────────────────

  async remove(id: string): Promise<boolean> {
    const handle = await this.get(id);
    if (!handle) return false;
    await handle.delete();
    return true;
  }

  async bringToFront(id: string): Promise<void> {
    const handle = await this.get(id);
    if (handle) await handle.bringToFront();
  }

  async sendToBack(id: string): Promise<void> {
    const handle = await this.get(id);
    if (handle) await handle.sendToBack();
  }

  async bringForward(id: string): Promise<void> {
    const handle = await this.get(id);
    if (handle) await handle.bringForward();
  }

  async sendBackward(id: string): Promise<void> {
    const handle = await this.get(id);
    if (handle) await handle.sendBackward();
  }

  async update(
    objectId: string,
    updates: Record<string, unknown>,
  ): Promise<FloatingObjectMutationReceipt> {
    return this.objectsImpl.update(objectId, updates);
  }

  async convertToTextEffect(objectId: string, warpPreset?: TextWarpPreset): Promise<void> {
    return this.objectsImpl.convertToTextEffect(objectId, warpPreset);
  }

  async convertToTextBox(objectId: string): Promise<void> {
    return this.objectsImpl.convertToTextBox(objectId);
  }

  // ── Sheet-level bounds queries ─────────────────────────────

  async computeObjectBounds(objectId: string): Promise<ObjectBounds | null> {
    return this.objectsImpl.computeObjectBounds(objectId);
  }

  async computeAllObjectBounds(): Promise<Map<string, ObjectBounds>> {
    return this.objectsImpl.computeAllObjectBounds();
  }

  // ── Grouping ───────────────────────────────────────────────

  async group(ids: string[]): Promise<string> {
    return this.objectsImpl.group(ids);
  }

  async ungroup(groupId: string): Promise<void> {
    return this.objectsImpl.ungroup(groupId);
  }

  private createHandle(id: string, type: FloatingObjectType): FloatingObjectHandle {
    return createFloatingObjectHandle(id, type, this.objectsImpl, this.boundsReader);
  }
}
