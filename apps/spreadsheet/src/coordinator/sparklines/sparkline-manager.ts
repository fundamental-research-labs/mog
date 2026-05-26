/**
 * Sparkline Manager
 *
 * Implements ISparklineManager interface for creating, managing, and rendering sparklines.
 * Delegates write operations to the Worksheet API and uses EventBus for coordination.
 *
 * Sparklines
 *
 * The manager maintains a local in-memory cache of sparklines for synchronous
 * interface compliance (ISparklineManager read methods are sync). Write operations
 * are async, delegating to the Worksheet API which handles ID generation, default
 * merging, and persistence.
 *
 * Key responsibilities:
 * - CRUD operations delegated to Worksheet API (write) + local cache (read)
 * - Render data computation and caching
 * - Data extraction from cells
 * - Event emission for render coordination
 */

import {
  type CellAddress,
  type CellRange,
  type SheetId,
  sheetId as toSheetId,
} from '@mog-sdk/contracts/core';
import type {
  CreateSparklineGroupOptions,
  CreateSparklineOptions,
  ISparklineManager,
  Sparkline,
  SparklineAxisSettings,
  SparklineDataPoint,
  SparklineGroup,
  SparklineRenderData,
  SparklineType,
  SparklineVisualSettings,
} from '@mog-sdk/contracts/sparklines';

import type { Workbook } from '@mog-sdk/contracts/api';
import type { IEventBus } from '@mog-sdk/contracts/events';

// =============================================================================
// Types
// =============================================================================

/**
 * Callback to get cell value from the store.
 * Returns the computed value (after formula evaluation) or raw value.
 */
type GetCellValueCallback = (sheetId: SheetId, row: number, col: number) => unknown;

/**
 * Configuration for SparklineManager.
 */
interface SparklineManagerConfig {
  /** Workbook instance for delegating sparkline operations */
  workbook: Workbook;
  /** Callback to get cell values (required for render data computation) */
  getCellValue: GetCellValueCallback;
  /** Per-document event bus for coordination events */
  eventBus: IEventBus;
}

// =============================================================================
// Default Values
// =============================================================================

const DEFAULT_AXIS: SparklineAxisSettings = {
  minValue: 'auto',
  maxValue: 'auto',
  showAxis: false,
  axisColor: '#9ca3af', // gray-400
  displayEmptyCells: 'gaps',
  rightToLeft: false,
};

// =============================================================================
// Sparkline Manager
// =============================================================================

export class SparklineManager implements ISparklineManager {
  private workbook: Workbook;
  private getCellValue: GetCellValueCallback;
  private eventBus: IEventBus;

  /** Cache for computed render data. Key: sparklineId */
  private renderDataCache: Map<string, SparklineRenderData> = new Map();

  /** Set of sparkline IDs with invalidated render data */
  private invalidatedIds: Set<string> = new Set();

  /**
   * Local in-memory cache of sparklines.
   * The ISparklineManager interface requires sync returns for reads.
   * We cache all sparklines locally so sync lookups work.
   * Writes delegate to the Worksheet API and update the local cache.
   * Key: sparklineId
   */
  private sparklineCache: Map<string, Sparkline> = new Map();

  /**
   * Local in-memory cache of sparkline groups.
   * Same rationale as sparklineCache.
   * Key: groupId
   */
  private groupCache: Map<string, SparklineGroup> = new Map();

  /** In-flight cell hydrations keyed by `${sheetId}:${row}:${col}`. */
  private pendingCellHydrations: Set<string> = new Set();

  /** In-flight sheet hydrations keyed by sheet id. */
  private pendingSheetHydrations: Set<string> = new Set();

  constructor(config: SparklineManagerConfig) {
    this.workbook = config.workbook;
    this.getCellValue = config.getCellValue;
    this.eventBus = config.eventBus;
  }

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  async createSparkline(
    sheetId: SheetId,
    cell: CellAddress,
    dataRange: CellRange,
    type: SparklineType,
    options?: CreateSparklineOptions,
  ): Promise<Sparkline> {
    const ws = this.workbook.getSheetById(sheetId);
    const sparkline = await ws.sparklines.add(cell, dataRange, type, options);
    this.sparklineCache.set(sparkline.id, sparkline);

    this.eventBus.emit({
      type: 'sparkline:created',
      timestamp: Date.now(),
      sheetId,
      sparklineId: sparkline.id,
      cell,
      sparklineType: type,
      sparkline,
      source: 'user',
    });

    return sparkline;
  }

  async createSparklineGroup(
    sheetId: SheetId,
    cells: CellAddress[],
    dataRanges: CellRange[],
    type: SparklineType,
    options?: CreateSparklineGroupOptions,
  ): Promise<SparklineGroup> {
    if (cells.length !== dataRanges.length) {
      throw new Error('Cells and dataRanges arrays must have the same length');
    }
    if (cells.length === 0) {
      throw new Error('Must provide at least one cell for sparkline group');
    }

    const ws = this.workbook.getSheetById(sheetId);
    const group = await ws.sparklines.addGroup(
      cells.map((c) => ({ row: c.row, col: c.col })),
      dataRanges,
      type,
      options,
    );

    // Cache the group
    this.groupCache.set(group.id, group);

    // Fetch and cache individual sparklines
    for (const sparklineId of group.sparklineIds) {
      const sparkline = await ws.sparklines.get(sparklineId);
      if (sparkline) {
        this.sparklineCache.set(sparklineId, sparkline);
      }
    }

    this.eventBus.emit({
      type: 'sparklineGroup:created',
      timestamp: Date.now(),
      sheetId,
      groupId: group.id,
      sparklineIds: group.sparklineIds,
      sparklineType: type,
      source: 'user',
    });

    return group;
  }

  getSparkline(sparklineId: string): Sparkline | undefined {
    // Sync read from local cache
    return this.sparklineCache.get(sparklineId);
  }

  getSparklineAtCell(sheetId: SheetId, row: number, col: number): Sparkline | undefined {
    // Sync read from local cache — scan for matching cell
    for (const sparkline of this.sparklineCache.values()) {
      if (
        sparkline.sheetId === sheetId &&
        sparkline.cell.row === row &&
        sparkline.cell.col === col
      ) {
        return sparkline;
      }
    }
    return undefined;
  }

  getSparklinesInSheet(sheetId: SheetId): Sparkline[] {
    // Sync read from local cache
    const result: Sparkline[] = [];
    for (const sparkline of this.sparklineCache.values()) {
      if (sparkline.sheetId === sheetId) {
        result.push(sparkline);
      }
    }
    return result;
  }

  getSparklineGroup(groupId: string): SparklineGroup | undefined {
    // Sync read from local cache
    return this.groupCache.get(groupId);
  }

  getSparklineGroupsInSheet(sheetId: SheetId): SparklineGroup[] {
    // Sync read from local cache
    const result: SparklineGroup[] = [];
    for (const group of this.groupCache.values()) {
      if (group.sheetId === sheetId) {
        result.push(group);
      }
    }
    return result;
  }

  /**
   * Hydrate this manager's sync cache from the worksheet API for a sheet.
   *
   * The renderer's hot path is synchronous, but Rust is the source of truth for
   * sparkline storage. Hydration bridges those contracts: imports, undo/redo,
   * direct Worksheet API calls, and remote mutations can update Rust first, then
   * repopulate this cache before the renderer asks for sparkline render data.
   */
  async hydrateSheet(sheetId: SheetId): Promise<number> {
    const key = String(sheetId);
    if (this.pendingSheetHydrations.has(key)) {
      return 0;
    }

    this.pendingSheetHydrations.add(key);
    try {
      const ws = this.workbook.getSheetById(sheetId);
      const [sparklines, groups] = await Promise.all([
        ws.sparklines.list(),
        ws.sparklines.listGroups(),
      ]);

      const previousSparklineIds = new Set<string>();
      for (const [sparklineId, sparkline] of this.sparklineCache) {
        if (sparkline.sheetId === sheetId) {
          previousSparklineIds.add(sparklineId);
          this.sparklineCache.delete(sparklineId);
          this.renderDataCache.delete(sparklineId);
          this.invalidatedIds.delete(sparklineId);
        }
      }
      for (const [groupId, group] of this.groupCache) {
        if (group.sheetId === sheetId) {
          this.groupCache.delete(groupId);
        }
      }

      for (const group of groups) {
        this.groupCache.set(group.id, group);
      }

      for (const sparkline of sparklines) {
        this.sparklineCache.set(sparkline.id, sparkline);
        this.invalidatedIds.add(sparkline.id);
      }

      const changedCount = sparklines.length + previousSparklineIds.size;
      if (changedCount > 0) {
        for (const sparkline of sparklines) {
          this.eventBus.emit({
            type: 'sparkline:dataChanged',
            timestamp: Date.now(),
            sheetId,
            sparklineId: sparkline.id,
            dataRange: sparkline.dataRange,
          });
        }
      }

      return changedCount;
    } finally {
      this.pendingSheetHydrations.delete(key);
    }
  }

  /**
   * Refresh the sync cache for one output cell from Rust.
   */
  async refreshSparklineAtCell(sheetId: SheetId, row: number, col: number): Promise<void> {
    const ws = this.workbook.getSheetById(sheetId);
    const sparkline = await ws.sparklines.getAtCell(row, col);

    for (const [sparklineId, cached] of this.sparklineCache) {
      if (cached.sheetId === sheetId && cached.cell.row === row && cached.cell.col === col) {
        this.sparklineCache.delete(sparklineId);
        this.renderDataCache.delete(sparklineId);
        this.invalidatedIds.delete(sparklineId);
      }
    }

    if (sparkline) {
      this.sparklineCache.set(sparkline.id, sparkline);
      this.invalidatedIds.add(sparkline.id);
    }

    if (sparkline) {
      this.eventBus.emit({
        type: 'sparkline:dataChanged',
        timestamp: Date.now(),
        sheetId,
        sparklineId: sparkline.id,
        dataRange: sparkline.dataRange,
      });
    }
  }

  async updateSparkline(sparklineId: string, updates: Partial<Sparkline>): Promise<void> {
    const existing = this.sparklineCache.get(sparklineId);
    if (!existing) return;

    // Update local cache optimistically
    const updated = { ...existing, ...updates, updatedAt: Date.now() } as Sparkline;
    this.sparklineCache.set(sparklineId, updated);

    // Delegate to worksheet API
    const ws = this.workbook.getSheetById(toSheetId(existing.sheetId));
    await ws.sparklines.update(sparklineId, updates);

    this.invalidateRenderData(sparklineId);

    this.eventBus.emit({
      type: 'sparkline:updated',
      timestamp: Date.now(),
      sheetId: existing.sheetId,
      sparklineId,
      changes: updates,
      source: 'user',
    });
  }

  async updateSparklineGroup(groupId: string, updates: Partial<SparklineGroup>): Promise<void> {
    const group = this.groupCache.get(groupId);
    if (!group) return;

    // Update local group cache
    const updatedGroup = { ...group, ...updates, updatedAt: Date.now() } as SparklineGroup;
    this.groupCache.set(groupId, updatedGroup);

    // Delegate to worksheet API (handles propagation to member sparklines)
    const ws = this.workbook.getSheetById(toSheetId(group.sheetId));
    await ws.sparklines.updateGroup(groupId, updates);

    // Update local sparkline caches too (for visual/type/axis changes)
    const sparklineUpdates: Record<string, unknown> = {};
    if (updates.visual) sparklineUpdates.visual = updates.visual;
    if (updates.type) sparklineUpdates.type = updates.type;
    if (updates.axis) sparklineUpdates.axis = updates.axis;

    if (Object.keys(sparklineUpdates).length > 0) {
      for (const sparklineId of group.sparklineIds) {
        const sparkline = this.sparklineCache.get(sparklineId);
        if (sparkline) {
          const updatedSparkline = {
            ...sparkline,
            ...sparklineUpdates,
            updatedAt: Date.now(),
          } as Sparkline;
          this.sparklineCache.set(sparklineId, updatedSparkline);
        }
      }
    }

    // Invalidate render data for all sparklines in group
    for (const sparklineId of group.sparklineIds) {
      this.invalidateRenderData(sparklineId);
    }

    this.eventBus.emit({
      type: 'sparklineGroup:updated',
      timestamp: Date.now(),
      sheetId: group.sheetId,
      groupId,
      changes: updates,
      source: 'user',
    });
  }

  async deleteSparkline(sparklineId: string): Promise<void> {
    const existing = this.sparklineCache.get(sparklineId);
    if (!existing) return;

    const sheetId = toSheetId(existing.sheetId);
    const cell = existing.cell;

    // Remove from local cache
    this.sparklineCache.delete(sparklineId);
    this.renderDataCache.delete(sparklineId);
    this.invalidatedIds.delete(sparklineId);

    // Delegate to worksheet API
    const ws = this.workbook.getSheetById(sheetId);
    await ws.sparklines.remove(sparklineId);

    this.eventBus.emit({
      type: 'sparkline:deleted',
      timestamp: Date.now(),
      sheetId,
      sparklineId,
      cell,
      source: 'user',
    });
  }

  async deleteSparklineGroup(groupId: string): Promise<void> {
    const group = this.groupCache.get(groupId);
    if (!group) return;

    const sparklineIds = [...group.sparklineIds];

    // Remove from local caches
    this.groupCache.delete(groupId);
    for (const sparklineId of sparklineIds) {
      this.sparklineCache.delete(sparklineId);
      this.renderDataCache.delete(sparklineId);
      this.invalidatedIds.delete(sparklineId);
    }

    // Delegate to worksheet API
    const ws = this.workbook.getSheetById(toSheetId(group.sheetId));
    await ws.sparklines.removeGroup(groupId);

    this.eventBus.emit({
      type: 'sparklineGroup:deleted',
      timestamp: Date.now(),
      sheetId: group.sheetId,
      groupId,
      sparklineIds,
      source: 'user',
    });
  }

  async clearSparklinesInRange(sheetId: SheetId, range: CellRange): Promise<void> {
    // Clear from local cache
    const toDelete: string[] = [];
    for (const sparkline of this.sparklineCache.values()) {
      if (
        sparkline.sheetId === sheetId &&
        sparkline.cell.row >= range.startRow &&
        sparkline.cell.row <= range.endRow &&
        sparkline.cell.col >= range.startCol &&
        sparkline.cell.col <= range.endCol &&
        !toDelete.includes(sparkline.id)
      ) {
        toDelete.push(sparkline.id);
      }
    }
    for (const sparklineId of toDelete) {
      this.sparklineCache.delete(sparklineId);
      this.renderDataCache.delete(sparklineId);
      this.invalidatedIds.delete(sparklineId);
    }

    // Delegate to worksheet API
    const ws = this.workbook.getSheetById(sheetId);
    await ws.sparklines.clearInRange(range);
  }

  // ===========================================================================
  // Group Management
  // ===========================================================================

  async addToGroup(sparklineId: string, groupId: string): Promise<void> {
    const sparkline = this.sparklineCache.get(sparklineId);
    if (!sparkline) return;

    // Update local cache
    const updated = { ...sparkline, groupId };
    this.sparklineCache.set(sparklineId, updated as Sparkline);

    const group = this.groupCache.get(groupId);
    if (group && !group.sparklineIds.includes(sparklineId)) {
      const updatedGroup = { ...group, sparklineIds: [...group.sparklineIds, sparklineId] };
      this.groupCache.set(groupId, updatedGroup);
    }

    // Delegate to worksheet API
    const ws = this.workbook.getSheetById(toSheetId(sparkline.sheetId));
    await ws.sparklines.addToGroup(sparklineId, groupId);

    this.invalidateRenderData(sparklineId);
  }

  async removeFromGroup(sparklineId: string): Promise<void> {
    const sparkline = this.sparklineCache.get(sparklineId);
    if (!sparkline) return;

    const oldGroupId = sparkline.groupId;

    // Update local cache
    const updated = { ...sparkline, groupId: undefined };
    this.sparklineCache.set(sparklineId, updated as Sparkline);

    if (oldGroupId) {
      const group = this.groupCache.get(oldGroupId);
      if (group) {
        const updatedGroup = {
          ...group,
          sparklineIds: group.sparklineIds.filter((id) => id !== sparklineId),
        };
        this.groupCache.set(oldGroupId, updatedGroup);
      }
    }

    // Delegate to worksheet API
    const ws = this.workbook.getSheetById(toSheetId(sparkline.sheetId));
    await ws.sparklines.removeFromGroup(sparklineId);

    this.invalidateRenderData(sparklineId);
  }

  async ungroupSparklines(groupId: string): Promise<string[]> {
    const group = this.groupCache.get(groupId);
    if (!group) return [];

    const sparklineIds = [...group.sparklineIds];

    // Update local caches
    for (const sparklineId of sparklineIds) {
      const sparkline = this.sparklineCache.get(sparklineId);
      if (sparkline) {
        const updated = { ...sparkline, groupId: undefined };
        this.sparklineCache.set(sparklineId, updated as Sparkline);
      }
    }
    this.groupCache.delete(groupId);

    // Delegate to worksheet API
    const ws = this.workbook.getSheetById(toSheetId(group.sheetId));
    await ws.sparklines.ungroupAll(groupId);

    // Invalidate render data for all ungrouped sparklines
    for (const sparklineId of sparklineIds) {
      this.invalidateRenderData(sparklineId);
    }

    return sparklineIds;
  }

  // ===========================================================================
  // Render Support
  // ===========================================================================

  computeRenderData(sparklineId: string): SparklineRenderData | undefined {
    const sparkline = this.sparklineCache.get(sparklineId);
    if (!sparkline) return undefined;

    // Get group settings if part of a group
    const group = sparkline.groupId ? this.groupCache.get(sparkline.groupId) : undefined;

    // Extract data values
    const values = this.extractDataValues(
      toSheetId(sparkline.sheetId),
      sparkline.dataRange,
      sparkline.dataInRows,
    );

    if (values.length === 0) {
      // No data - return empty render data
      return {
        sparklineId,
        type: sparkline.type,
        points: [],
        minValue: 0,
        maxValue: 0,
        firstPointIndex: 0,
        lastPointIndex: 0,
        visual: this.resolveVisual(sparkline, group),
        showAxis: this.resolveShowAxis(sparkline),
      };
    }

    // Calculate min/max
    const numericValues = values.filter((v): v is number => v !== null && typeof v === 'number');

    let minValue: number;
    let maxValue: number;

    if (numericValues.length === 0) {
      minValue = 0;
      maxValue = 0;
    } else {
      // Handle group axis scaling
      const axis = this.resolveAxis(sparkline, group);

      if (axis.minValue === 'same' && group) {
        // Calculate min across all sparklines in group
        minValue = this.calculateGroupMin(group);
      } else if (typeof axis.minValue === 'number') {
        minValue = axis.minValue;
      } else {
        minValue = Math.min(...numericValues);
      }

      if (axis.maxValue === 'same' && group) {
        // Calculate max across all sparklines in group
        maxValue = this.calculateGroupMax(group);
      } else if (typeof axis.maxValue === 'number') {
        maxValue = axis.maxValue;
      } else {
        maxValue = Math.max(...numericValues);
      }
    }

    // Normalize values to 0-1 range
    const range = maxValue - minValue || 1;
    const points: SparklineDataPoint[] = values.map((v, i) => {
      const isNull = v === null;
      const value = isNull ? 0 : (v as number);
      const normalizedY = isNull ? 0 : (value - minValue) / range;

      return {
        x: values.length > 1 ? i / (values.length - 1) : 0.5,
        y: normalizedY,
        value,
        isNull,
      };
    });

    // Find special points
    let highPointIndex: number | undefined;
    let lowPointIndex: number | undefined;
    let firstPointIndex = 0;
    let lastPointIndex = points.length - 1;

    if (numericValues.length > 0) {
      const maxVal = Math.max(...numericValues);
      const minVal = Math.min(...numericValues);

      for (let i = 0; i < points.length; i++) {
        if (!points[i].isNull) {
          if (firstPointIndex === 0 && points[0].isNull) {
            firstPointIndex = i;
          }
          if (points[i].value === maxVal && highPointIndex === undefined) {
            highPointIndex = i;
          }
          if (points[i].value === minVal && lowPointIndex === undefined) {
            lowPointIndex = i;
          }
          lastPointIndex = i;
        }
      }
    }

    // Calculate axis position (where value = 0)
    let axisPosition: number | undefined;
    if (minValue < 0 && maxValue > 0) {
      axisPosition = (0 - minValue) / range;
    }

    const renderData: SparklineRenderData = {
      sparklineId,
      type: sparkline.type,
      points,
      minValue,
      maxValue,
      highPointIndex,
      lowPointIndex,
      firstPointIndex,
      lastPointIndex,
      visual: this.resolveVisual(sparkline, group),
      showAxis: this.resolveShowAxis(sparkline),
      axisPosition,
    };

    // Cache the result
    this.renderDataCache.set(sparklineId, renderData);
    this.invalidatedIds.delete(sparklineId);

    return renderData;
  }

  getRenderData(sparklineId: string): SparklineRenderData | undefined {
    // If cached and not invalidated, return cached
    if (this.renderDataCache.has(sparklineId) && !this.invalidatedIds.has(sparklineId)) {
      return this.renderDataCache.get(sparklineId);
    }

    // Compute and cache
    return this.computeRenderData(sparklineId);
  }

  /**
   * Get render data for a cell.
   * This is the primary method used by the renderer.
   */
  getRenderDataAtCell(sheetId: SheetId, row: number, col: number): SparklineRenderData | undefined {
    // Sync lookup from local cache
    const sparkline = this.getSparklineAtCell(sheetId, row, col);
    if (!sparkline) {
      this.queueHydrateCell(sheetId, row, col);
      return undefined;
    }
    return this.getRenderData(sparkline.id);
  }

  invalidateRenderData(sparklineId: string): void {
    this.invalidatedIds.add(sparklineId);

    // Emit data changed event
    const sparkline = this.sparklineCache.get(sparklineId);
    if (sparkline) {
      this.eventBus.emit({
        type: 'sparkline:dataChanged',
        timestamp: Date.now(),
        sheetId: sparkline.sheetId,
        sparklineId,
        dataRange: sparkline.dataRange,
      });
    }
  }

  invalidateRenderDataInRange(sheetId: SheetId, range: CellRange): void {
    // Find from local cache
    const affectedSparklines = this.getSparklinesWithDataInRange(sheetId, range);

    for (const sparkline of affectedSparklines) {
      this.invalidateRenderData(sparkline.id);
    }
  }

  /**
   * Invalidate all render data cache.
   * Called on sheet switch or major data changes.
   */
  invalidateAll(): void {
    // Mark all cached items as invalidated
    for (const sparklineId of this.renderDataCache.keys()) {
      this.invalidatedIds.add(sparklineId);
    }
  }

  // ===========================================================================
  // Query Methods
  // ===========================================================================

  hasSparkline(sheetId: SheetId, row: number, col: number): boolean {
    // Sync lookup from local cache
    return this.getSparklineAtCell(sheetId, row, col) !== undefined;
  }

  getSparklinesWithDataInRange(sheetId: SheetId, range: CellRange): Sparkline[] {
    // Sync lookup from local cache
    const result: Sparkline[] = [];
    for (const sparkline of this.sparklineCache.values()) {
      if (
        sparkline.sheetId === sheetId &&
        sparkline.dataRange.startRow <= range.endRow &&
        sparkline.dataRange.endRow >= range.startRow &&
        sparkline.dataRange.startCol <= range.endCol &&
        sparkline.dataRange.endCol >= range.startCol
      ) {
        result.push(sparkline);
      }
    }
    return result;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Extract numeric values from a data range.
   * @returns Array of numbers (null for empty cells)
   */
  private extractDataValues(
    sheetId: SheetId,
    range: CellRange,
    dataInRows: boolean,
  ): (number | null)[] {
    const values: (number | null)[] = [];

    if (dataInRows) {
      // Data is in a row (iterate columns)
      const row = range.startRow;
      for (let col = range.startCol; col <= range.endCol; col++) {
        const value = this.getCellValue(sheetId, row, col);
        values.push(this.toNumericValue(value));
      }
    } else {
      // Data is in a column (iterate rows)
      const col = range.startCol;
      for (let row = range.startRow; row <= range.endRow; row++) {
        const value = this.getCellValue(sheetId, row, col);
        values.push(this.toNumericValue(value));
      }
    }

    return values;
  }

  /**
   * Convert a cell value to a numeric value or null.
   */
  private toNumericValue(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    if (typeof value === 'number') {
      return isNaN(value) ? null : value;
    }
    if (typeof value === 'string') {
      const num = parseFloat(value);
      return isNaN(num) ? null : num;
    }
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    return null;
  }

  private queueHydrateCell(sheetId: SheetId, row: number, col: number): void {
    const key = `${sheetId}:${row}:${col}`;
    if (this.pendingCellHydrations.has(key)) return;

    this.pendingCellHydrations.add(key);
    void this.hydrateCell(sheetId, row, col).finally(() => {
      this.pendingCellHydrations.delete(key);
    });
  }

  private async hydrateCell(sheetId: SheetId, row: number, col: number): Promise<void> {
    const ws = this.workbook.getSheetById(sheetId);
    const sparkline = await ws.sparklines.getAtCell(row, col);
    if (!sparkline) return;

    this.sparklineCache.set(sparkline.id, sparkline);
    if (sparkline.groupId && !this.groupCache.has(sparkline.groupId)) {
      const group = await ws.sparklines.getGroup(sparkline.groupId);
      if (group) {
        this.groupCache.set(group.id, group);
      }
    }

    this.invalidateRenderData(sparkline.id);
  }

  /**
   * Resolve visual settings (sparkline or group).
   */
  private resolveVisual(sparkline: Sparkline, group?: SparklineGroup): SparklineVisualSettings {
    if (group) {
      return { ...group.visual };
    }
    return { ...sparkline.visual };
  }

  /**
   * Resolve axis settings (sparkline or group).
   */
  private resolveAxis(sparkline: Sparkline, group?: SparklineGroup): SparklineAxisSettings {
    if (group) {
      return { ...group.axis };
    }
    if (sparkline.type === 'winLoss') {
      return DEFAULT_AXIS;
    }
    return { ...sparkline.axis };
  }

  /**
   * Resolve showAxis setting.
   */
  private resolveShowAxis(sparkline: Sparkline): boolean {
    return sparkline.axis.showAxis ?? false;
  }

  /**
   * Calculate minimum value across all sparklines in a group.
   */
  private calculateGroupMin(group: SparklineGroup): number {
    let min = Infinity;

    for (const sparklineId of group.sparklineIds) {
      const sparkline = this.sparklineCache.get(sparklineId);
      if (!sparkline) continue;

      const values = this.extractDataValues(
        toSheetId(sparkline.sheetId),
        sparkline.dataRange,
        sparkline.dataInRows,
      );

      const numericValues = values.filter((v): v is number => v !== null);
      if (numericValues.length > 0) {
        const localMin = Math.min(...numericValues);
        if (localMin < min) min = localMin;
      }
    }

    return min === Infinity ? 0 : min;
  }

  /**
   * Calculate maximum value across all sparklines in a group.
   */
  private calculateGroupMax(group: SparklineGroup): number {
    let max = -Infinity;

    for (const sparklineId of group.sparklineIds) {
      const sparkline = this.sparklineCache.get(sparklineId);
      if (!sparkline) continue;

      const values = this.extractDataValues(
        toSheetId(sparkline.sheetId),
        sparkline.dataRange,
        sparkline.dataInRows,
      );

      const numericValues = values.filter((v): v is number => v !== null);
      if (numericValues.length > 0) {
        const localMax = Math.max(...numericValues);
        if (localMax > max) max = localMax;
      }
    }

    return max === -Infinity ? 0 : max;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Clear all caches. Called on store disposal.
   */
  dispose(): void {
    this.renderDataCache.clear();
    this.invalidatedIds.clear();
    this.sparklineCache.clear();
    this.groupCache.clear();
    this.pendingCellHydrations.clear();
    this.pendingSheetHydrations.clear();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a SparklineManager instance.
 */
export function createSparklineManager(config: SparklineManagerConfig): SparklineManager {
  return new SparklineManager(config);
}
