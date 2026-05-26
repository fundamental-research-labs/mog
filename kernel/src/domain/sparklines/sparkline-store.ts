/**
 * Sparkline Store
 *
 * Delegates all data access to ComputeBridge (Rust compute-core).
 *
 * Architecture:
 * - Write operations: fire-and-forget via computeBridge
 * - Read operations: async via computeBridge
 * - Events: handled by MutationResultHandler from Rust MutationResult
 * - Subscriptions: handled by MutationResultHandler (no CRDT observers)
 *
 * The class is retained for API compatibility but all storage operations
 * delegate to ComputeBridge. The bridge reference is injected via init().
 *
 * Sparklines store
 *
 * @see compute-core/src/storage/sparklines.rs - Rust implementation
 */

import type { Sparkline, SparklineDataRange, SparklineGroup } from '@mog-sdk/contracts/sparklines';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';

import type { ComputeBridge } from '../../bridges/compute/compute-bridge';
import type { Sparkline as BridgeSparkline } from '../../bridges/compute/compute-types.gen';
import { KernelError } from '../../errors';

// =============================================================================
// Sparkline Store Class
// =============================================================================

/**
 * Manages sparkline configurations via ComputeBridge.
 *
 * All CRUD operations delegate to the Rust compute core. The class provides
 * a synchronous-looking API surface but internally uses fire-and-forget
 * for writes and async for reads.
 */
export class SparklineStore {
  private bridge: ComputeBridge | null = null;

  /**
   * Initialize the store with a ComputeBridge reference.
   * Must be called before any operations.
   */
  init(bridge: ComputeBridge): void {
    this.bridge = bridge;
  }

  private ensureBridge(): ComputeBridge {
    if (!this.bridge) {
      throw new KernelError(
        'DOMAIN_SPARKLINE_NOT_INITIALIZED',
        '[SparklineStore] Not initialized - call init() first',
      );
    }
    return this.bridge;
  }

  private fromBridgeSparkline(sparkline: BridgeSparkline): Sparkline {
    return {
      ...sparkline,
      sheetId: toSheetId(sparkline.sheetId),
    };
  }

  // ===========================================================================
  // CRUD Operations - Sparklines
  // ===========================================================================

  /**
   * Add a new sparkline.
   * Delegates to ComputeBridge.addSparkline.
   */
  addSparkline(sparkline: Sparkline): void {
    const bridge = this.ensureBridge();
    void bridge.addSparkline(sparkline.sheetId, sparkline);
  }

  /**
   * Get a sparkline by ID.
   * Delegates to ComputeBridge.getSparklinesInSheet and filters.
   */
  async getSparklineAsync(sparklineId: string, sheetId: SheetId): Promise<Sparkline | undefined> {
    const bridge = this.ensureBridge();
    const all = await bridge.getSparklinesInSheet(sheetId);
    const found = all.find((s) => s.id === sparklineId);
    return found ? this.fromBridgeSparkline(found) : undefined;
  }

  /**
   * Get sparkline at a specific cell.
   * Delegates to ComputeBridge.getSparklinesInSheet and filters.
   */
  async getSparklineAtCellAsync(
    sheetId: SheetId,
    row: number,
    col: number,
  ): Promise<Sparkline | undefined> {
    const bridge = this.ensureBridge();
    const all = await bridge.getSparklinesInSheet(sheetId);
    const found = all.find((s) => s.cell?.row === row && s.cell?.col === col);
    return found ? this.fromBridgeSparkline(found) : undefined;
  }

  /**
   * Get all sparklines in a sheet.
   * Delegates to ComputeBridge.getSparklinesInSheet.
   */
  async getSparklinesInSheetAsync(sheetId: SheetId): Promise<Sparkline[]> {
    const bridge = this.ensureBridge();
    const sparklines = await bridge.getSparklinesInSheet(sheetId);
    return sparklines.map((sparkline) => this.fromBridgeSparkline(sparkline));
  }

  /**
   * Get all sparklines across all sheets.
   * Note: Requires iterating all sheets - callers should prefer sheet-scoped queries.
   */
  async getAllSparklinesAsync(sheetIds: SheetId[]): Promise<Sparkline[]> {
    const bridge = this.ensureBridge();
    const result: Sparkline[] = [];
    for (const sheetId of sheetIds) {
      const sparklines = await bridge.getSparklinesInSheet(sheetId);
      result.push(...sparklines.map((sparkline) => this.fromBridgeSparkline(sparkline)));
    }
    return result;
  }

  /**
   * Update an existing sparkline.
   * Delegates to ComputeBridge.updateSparkline.
   */
  updateSparkline(sparklineId: string, updates: Partial<Sparkline>): void {
    const bridge = this.ensureBridge();
    // We need the sheetId for the CB call. If updates contain it, use it.
    // Otherwise this is a best-effort fire-and-forget.
    const sheetId = updates.sheetId;
    if (sheetId) {
      void bridge.updateSparkline(sheetId, sparklineId, updates);
    }
  }

  /**
   * Delete a sparkline.
   * Delegates to ComputeBridge.deleteSparkline.
   */
  deleteSparkline(sparklineId: string, sheetId: SheetId): void {
    const bridge = this.ensureBridge();
    void bridge.deleteSparkline(sheetId, sparklineId);
  }

  // ===========================================================================
  // CRUD Operations - Groups
  // ===========================================================================

  /**
   * Add a new sparkline group.
   * Groups are managed by Rust compute-core. The CB handles group membership.
   */
  addSparklineGroup(group: SparklineGroup): void {
    // Group management is handled atomically by the compute core.
    // Individual sparklines are added with groupId set.
    const bridge = this.ensureBridge();
    // SparklineGroup.sheetId is raw string (contract gap deferred from principal plumbing2);
    // brand at the seam before calling into the branded bridge.
    const groupSheetId = toSheetId(group.sheetId);
    for (const sparklineId of group.sparklineIds) {
      void bridge.updateSparkline(groupSheetId, sparklineId, { groupId: group.id });
    }
  }

  /**
   * Update a sparkline group.
   * Delegates to ComputeBridge by updating all sparklines in the group.
   */
  updateSparklineGroup(groupId: string, updates: Partial<SparklineGroup>): void {
    // Group visual settings are propagated to member sparklines by Rust.
    // This is a no-op at the domain level since Rust handles group semantics.
    void groupId;
    void updates;
  }

  /**
   * Delete a sparkline group.
   * @param deleteSparklines If true, also delete all sparklines in the group.
   */
  deleteSparklineGroup(
    groupId: string,
    sheetId: SheetId,
    sparklineIds: string[],
    deleteSparklines: boolean = true,
  ): void {
    const bridge = this.ensureBridge();
    if (deleteSparklines) {
      for (const sparklineId of sparklineIds) {
        void bridge.deleteSparkline(sheetId, sparklineId);
      }
    } else {
      // Remove group reference from sparklines
      for (const sparklineId of sparklineIds) {
        void bridge.updateSparkline(sheetId, sparklineId, { groupId: null });
      }
    }
  }

  // ===========================================================================
  // Group Membership Operations
  // ===========================================================================

  /**
   * Add a sparkline to a group.
   */
  addToGroup(sparklineId: string, groupId: string, sheetId: SheetId): void {
    const bridge = this.ensureBridge();
    void bridge.updateSparkline(sheetId, sparklineId, { groupId });
  }

  /**
   * Remove a sparkline from its group (becomes standalone).
   */
  removeFromGroup(sparklineId: string, sheetId: SheetId): void {
    const bridge = this.ensureBridge();
    void bridge.updateSparkline(sheetId, sparklineId, { groupId: null });
  }

  // ===========================================================================
  // Range Operations
  // ===========================================================================

  /**
   * Clear all sparklines in a range.
   */
  clearSparklinesInRange(sheetId: SheetId, range: SparklineDataRange): void {
    const bridge = this.ensureBridge();
    void (async () => {
      const sparklines = await bridge.getSparklinesInSheet(sheetId);
      for (const sparkline of sparklines) {
        if (
          sparkline.cell.row >= range.startRow &&
          sparkline.cell.row <= range.endRow &&
          sparkline.cell.col >= range.startCol &&
          sparkline.cell.col <= range.endCol
        ) {
          void bridge.deleteSparkline(sheetId, sparkline.id);
        }
      }
    })();
  }

  /**
   * Clear all sparklines for a sheet.
   * Called when a sheet is deleted.
   */
  clearSparklinesForSheet(sheetId: SheetId): void {
    const bridge = this.ensureBridge();
    void (async () => {
      const sparklines = await bridge.getSparklinesInSheet(sheetId);
      for (const sparkline of sparklines) {
        void bridge.deleteSparkline(sheetId, sparkline.id);
      }
    })();
  }

  // ===========================================================================
  // Query Operations
  // ===========================================================================

  /**
   * Check if a cell has a sparkline (async).
   */
  async hasSparklineAsync(sheetId: SheetId, row: number, col: number): Promise<boolean> {
    const sparkline = await this.getSparklineAtCellAsync(sheetId, row, col);
    return sparkline !== undefined;
  }

  /**
   * Get sparklines whose data range intersects with a given range (async).
   */
  async getSparklinesWithDataInRangeAsync(
    sheetId: SheetId,
    range: SparklineDataRange,
  ): Promise<Sparkline[]> {
    const bridge = this.ensureBridge();
    const all = await bridge.getSparklinesInSheet(sheetId);
    return all
      .filter((sparkline) => {
        return (
          sparkline.dataRange.startRow <= range.endRow &&
          sparkline.dataRange.endRow >= range.startRow &&
          sparkline.dataRange.startCol <= range.endCol &&
          sparkline.dataRange.endCol >= range.startCol
        );
      })
      .map((sparkline) => this.fromBridgeSparkline(sparkline));
  }

  // ===========================================================================
  // Observers
  // ===========================================================================

  /**
   * Subscribe to changes.
   *
   * In the ComputeBridge architecture, sparkline change notifications come
   * through MutationResult events, not CRDT observe. This is a compatibility stub.
   *
   * @returns Unsubscribe function (no-op)
   */
  subscribe(_callback: () => void): () => void {
    // In the ComputeBridge architecture, sparkline change notifications come
    // through MutationResult events. This is a compatibility stub.
    return () => {};
  }

  // ===========================================================================
  // Utility
  // ===========================================================================

  /**
   * Generate a unique sparkline ID.
   */
  generateSparklineId(): string {
    return `sparkline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  /**
   * Generate a unique group ID.
   */
  generateGroupId(): string {
    return `sparkline-group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }
}

// =============================================================================
// Singleton Management
// =============================================================================

let sparklineStoreInstance: SparklineStore | null = null;

/**
 * Get the SparklineStore singleton instance.
 * Creates a new instance if one doesn't exist.
 *
 * @param bridge - Optional ComputeBridge to initialize with.
 *                 If provided and the store is new, it will be initialized.
 */
export function getSparklineStore(bridge?: ComputeBridge): SparklineStore {
  if (!sparklineStoreInstance) {
    sparklineStoreInstance = new SparklineStore();
    if (bridge) {
      sparklineStoreInstance.init(bridge);
    }
  }
  return sparklineStoreInstance;
}

/**
 * Reset the SparklineStore singleton (for testing).
 */
export function resetSparklineStore(): void {
  sparklineStoreInstance = null;
}
