/**
 * WorksheetSparklinesImpl — Implementation of the WorksheetSparklines sub-API.
 *
 * Calls computeBridge directly. Business logic (defaults, grouping, range filtering)
 * is inlined here. All mutations throw KernelError on failure.
 */

import type { CellRange, SheetId, WorksheetSparklines } from '@mog-sdk/contracts/api';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  CreateSparklineGroupOptions,
  CreateSparklineOptions,
  Sparkline,
  SparklineGroup,
  SparklineType,
  SparklineVisualSettings,
} from '@mog-sdk/contracts/sparklines';

import type { Sparkline as BridgeSparkline } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import { resolveCell, resolveRange } from '../internal/address-resolver';

// =============================================================================
// ID Generation
// =============================================================================

function generateSparklineId(): string {
  return `sparkline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function generateGroupId(): string {
  return `sparkline-group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// =============================================================================
// Default Settings
// =============================================================================

const DEFAULT_VISUAL: SparklineVisualSettings = {
  color: '#4472C4',
};

const DEFAULT_AXIS: Sparkline['axis'] = {
  minValue: 'auto',
  maxValue: 'auto',
  displayEmptyCells: 'gaps',
};

function fromBridgeSparkline(sparkline: BridgeSparkline): Sparkline {
  return {
    ...sparkline,
    sheetId: toSheetId(sparkline.sheetId),
  };
}

export class WorksheetSparklinesImpl implements WorksheetSparklines {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  async add(
    cellOrRow: string | number | { row: number; col: number },
    dataRangeOrCol: string | number | CellRange,
    typeOrDataRange?: SparklineType | string | CellRange,
    optionsOrType?: CreateSparklineOptions | SparklineType,
    maybeOptions?: CreateSparklineOptions,
  ): Promise<Sparkline> {
    let cell: { row: number; col: number };
    let dataRange: CellRange;
    let type: SparklineType;
    let options: CreateSparklineOptions | undefined;

    if (typeof cellOrRow === 'object') {
      // Legacy object form: add({ row, col }, dataRange, type, options?)
      cell = cellOrRow;
      dataRange = resolveRange(dataRangeOrCol as string | CellRange);
      type = typeOrDataRange as SparklineType;
      options = optionsOrType as CreateSparklineOptions | undefined;
    } else if (typeof cellOrRow === 'string') {
      // A1 string form: add("B1", dataRange, type, options?)
      cell = resolveCell(cellOrRow);
      dataRange = resolveRange(dataRangeOrCol as string | CellRange);
      type = typeOrDataRange as SparklineType;
      options = optionsOrType as CreateSparklineOptions | undefined;
    } else {
      // Numeric form: add(row, col, dataRange, type, options?)
      cell = { row: cellOrRow, col: dataRangeOrCol as number };
      dataRange = resolveRange(typeOrDataRange as string | CellRange);
      type = optionsOrType as SparklineType;
      options = maybeOptions;
    }

    const sparkline: Sparkline = {
      id: generateSparklineId(),
      sheetId: this.sheetId,
      cell: { sheetId: this.sheetId, ...cell },
      dataRange,
      type,
      dataInRows: options?.dataInRows ?? false,
      visual: { ...DEFAULT_VISUAL, ...options?.visual },
      axis: { ...DEFAULT_AXIS, ...options?.axis },
      createdAt: Date.now(),
    };

    await this.ctx.computeBridge.addSparkline(this.sheetId, sparkline);
    return sparkline;
  }

  async addGroup(
    cells: Array<{ row: number; col: number }>,
    dataRanges: CellRange[],
    type: SparklineType,
    options?: CreateSparklineGroupOptions,
  ): Promise<SparklineGroup> {
    if (cells.length !== dataRanges.length) {
      throw new KernelError(
        'OPERATION_FAILED',
        `Operation "addSparklineGroup" failed: cells length (${cells.length}) must match dataRanges length (${dataRanges.length})`,
      );
    }

    const groupId = generateGroupId();
    const visual = { ...DEFAULT_VISUAL, ...options?.visual };
    const axis = { ...DEFAULT_AXIS, ...options?.axis };

    const sparklines: Sparkline[] = cells.map((cell, i) => ({
      id: generateSparklineId(),
      sheetId: this.sheetId,
      cell: { sheetId: this.sheetId, ...cell },
      dataRange: dataRanges[i],
      type,
      dataInRows: options?.dataInRows ?? false,
      visual,
      axis,
      groupId,
      createdAt: Date.now(),
    }));

    await Promise.all(
      sparklines.map((sparkline) => this.ctx.computeBridge.addSparkline(this.sheetId, sparkline)),
    );

    const group: SparklineGroup = {
      id: groupId,
      sheetId: this.sheetId,
      sparklineIds: sparklines.map((s) => s.id),
      type,
      visual,
      axis,
      createdAt: Date.now(),
    };

    await this.ctx.computeBridge.addSparklineGroup(this.sheetId, group);

    return group;
  }

  async get(sparklineId: string): Promise<Sparkline | null> {
    const sparkline = await this.ctx.computeBridge.getSparkline(this.sheetId, sparklineId);
    return sparkline ? fromBridgeSparkline(sparkline) : null;
  }

  async getAtCell(a: string | number, b?: number): Promise<Sparkline | null> {
    const { row, col } = resolveCell(a, b);
    const sparkline = await this.ctx.computeBridge.getSparklineAtCell(this.sheetId, row, col);
    return sparkline ? fromBridgeSparkline(sparkline) : null;
  }

  async list(): Promise<Sparkline[]> {
    const sparklines = await this.ctx.computeBridge.getSparklinesInSheet(this.sheetId);
    return sparklines.map(fromBridgeSparkline);
  }

  async getGroup(groupId: string): Promise<SparklineGroup | null> {
    return this.ctx.computeBridge.getSparklineGroup(this.sheetId, groupId);
  }

  async listGroups(): Promise<SparklineGroup[]> {
    return this.ctx.computeBridge.getSparklineGroupsInSheet(this.sheetId);
  }

  async update(sparklineId: string, updates: Partial<Sparkline>): Promise<void> {
    await this.ctx.computeBridge.updateSparkline(this.sheetId, sparklineId, updates);
  }

  async updateGroup(groupId: string, updates: Partial<SparklineGroup>): Promise<void> {
    const group = await this.getGroup(groupId);
    if (!group) {
      throw new KernelError(
        'OPERATION_FAILED',
        `Operation "updateSparklineGroup" failed: Group "${groupId}" not found`,
      );
    }

    const updatedGroup: SparklineGroup = {
      ...group,
      ...updates,
      updatedAt: this.ctx.clock.now(),
    };

    // Propagate updates to all member sparklines.
    const memberUpdates: Partial<Sparkline> = {};
    if (updatedGroup.visual) memberUpdates.visual = updatedGroup.visual;
    if (updatedGroup.axis) memberUpdates.axis = updatedGroup.axis;
    if (updates.type) memberUpdates.type = updates.type;

    await Promise.all(
      group.sparklineIds.map((sparklineId) =>
        this.ctx.computeBridge.updateSparkline(this.sheetId, sparklineId, memberUpdates),
      ),
    );

    await this.ctx.computeBridge.addSparklineGroup(this.sheetId, updatedGroup);
  }

  async remove(sparklineId: string): Promise<void> {
    await this.ctx.computeBridge.deleteSparkline(this.sheetId, sparklineId);
  }

  async removeGroup(groupId: string): Promise<void> {
    await this.ctx.computeBridge.deleteSparklineGroup(this.sheetId, groupId, true);
  }

  async clearInRange(range: string | CellRange): Promise<void> {
    const bounds = resolveRange(range);
    await this.ctx.computeBridge.clearSparklinesInRange(
      this.sheetId,
      bounds.startRow,
      bounds.startCol,
      bounds.endRow,
      bounds.endCol,
    );
  }

  async clear(): Promise<void> {
    await this.ctx.computeBridge.clearSparklinesForSheet(this.sheetId);
  }

  /** @deprecated Use `clear()` instead. */
  async clearAll(): Promise<void> {
    return this.clear();
  }

  async addToGroup(sparklineId: string, groupId: string): Promise<void> {
    await this.ctx.computeBridge.updateSparkline(this.sheetId, sparklineId, { groupId });
    // Also update the group's sparklineIds in the store
    const group = await this.ctx.computeBridge.getSparklineGroup(this.sheetId, groupId);
    if (group && !group.sparklineIds.includes(sparklineId)) {
      group.sparklineIds.push(sparklineId);
      await this.ctx.computeBridge.addSparklineGroup(this.sheetId, group);
    }
  }

  async removeFromGroup(sparklineId: string): Promise<void> {
    // Find the sparkline's current group before clearing it
    const sparkline = await this.ctx.computeBridge.getSparkline(this.sheetId, sparklineId);
    await this.ctx.computeBridge.updateSparkline(this.sheetId, sparklineId, { groupId: null });
    // Also update the group's sparklineIds in the store
    if (sparkline?.groupId) {
      const group = await this.ctx.computeBridge.getSparklineGroup(this.sheetId, sparkline.groupId);
      if (group) {
        group.sparklineIds = group.sparklineIds.filter((id) => id !== sparklineId);
        await this.ctx.computeBridge.addSparklineGroup(this.sheetId, group);
      }
    }
  }

  async ungroupAll(groupId: string): Promise<string[]> {
    const group = await this.getGroup(groupId);
    if (!group) {
      throw new KernelError(
        'OPERATION_FAILED',
        `Operation "ungroupSparklines" failed: Group "${groupId}" not found`,
      );
    }

    await Promise.all(
      group.sparklineIds.map((sparklineId) =>
        this.ctx.computeBridge.updateSparkline(this.sheetId, sparklineId, { groupId: null }),
      ),
    );
    return group.sparklineIds;
  }

  async has(a: string | number, b?: number): Promise<boolean> {
    const { row, col } = resolveCell(a, b);
    return this.ctx.computeBridge.hasSparkline(this.sheetId, row, col);
  }

  async getCount(): Promise<number> {
    return (await this.list()).length;
  }

  async getWithDataInRange(range: string | CellRange): Promise<Sparkline[]> {
    const bounds = resolveRange(range);
    const all = await this.list();
    return all.filter(
      (s) =>
        s.dataRange.startRow <= bounds.endRow &&
        s.dataRange.endRow >= bounds.startRow &&
        s.dataRange.startCol <= bounds.endCol &&
        s.dataRange.endCol >= bounds.startCol,
    );
  }
}
