/**
 * Ungated Adapter - Wraps a full IAppKernelAPI as IGatedAppKernelAPI
 *
 * Used in legacy/fallback paths where no capability system is available
 * but the downstream consumer expects IGatedAppKernelAPI. The adapter
 * exposes ALL sub-APIs and reports all capabilities as granted.
 *
 * This is the proper replacement for `kernel as unknown as IGatedAppKernelAPI`
 * casts that were previously used in AppSlot.
 *
 */

import type { IAppKernelAPI } from '@mog-sdk/contracts/apps';
import { getAllCapabilities, type CapabilityType } from '../../../services/capabilities/cap-types';
import type {
  ICapabilityIntrospection,
  IGatedAppKernelAPI,
} from '../../../services/capabilities/gated-api';
import type { CapabilityScope } from '../../../services/capabilities/scope';

/**
 * A no-op capability introspection that reports all capabilities as granted.
 */
const grantAllIntrospection: ICapabilityIntrospection = {
  has(_capability: CapabilityType): boolean {
    return true;
  },
  list(): CapabilityType[] {
    // Return all capabilities since has() returns true for everything.
    // This ensures semantic consistency: list() reflects what has() reports.
    return getAllCapabilities();
  },
  isScoped(_capability: CapabilityType): boolean {
    return false;
  },
  getScope(_capability: CapabilityType): CapabilityScope | null {
    return null;
  },
  hasAccessTo(_capability: CapabilityType, _resourceType: string, _resourceId: string): boolean {
    return true;
  },
  request(_capability: CapabilityType, _reason: string): Promise<boolean> {
    return Promise.resolve(true);
  },
  onChange(_callback: (capabilities: CapabilityType[]) => void): () => void {
    return () => {};
  },
  onExpiring(_callback: (capability: CapabilityType, expiresInMs: number) => void): () => void {
    return () => {};
  },
};

/**
 * Wraps a full IAppKernelAPI as IGatedAppKernelAPI without any gating.
 *
 * All sub-APIs are passed through directly. The capabilities introspection
 * reports everything as granted. This is used when no capability registry
 * is available (legacy mode).
 *
 * @param fullApi - The full, unrestricted kernel API
 * @returns An IGatedAppKernelAPI that allows everything
 */
export function createUngatedAdapter(fullApi: IAppKernelAPI): IGatedAppKernelAPI {
  return {
    capabilities: grantAllIntrospection,
    undoGroup: fullApi.undoGroup.bind(fullApi),

    // Data sub-APIs (pass through directly)
    tables: fullApi.tables,
    columns: fullApi.columns,
    records: fullApi.records,
    relations: fullApi.relations,
    events: fullApi.events,
    clipboard: fullApi.clipboard,
    undo: fullApi.undo,
  };
}
