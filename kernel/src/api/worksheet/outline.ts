/**
 * WorksheetOutlineImpl — Implementation of the WorksheetOutline sub-API.
 *
 * Delegates to grouping-operations module.
 * Operations that return OperationResult are unwrapped inline.
 */

import type {
  GroupState,
  OutlineSettings,
  SheetId,
  SubtotalConfig,
  SubtotalResult,
  WorksheetOutline,
} from '@mog-sdk/contracts/api';
import type { GroupDefinition } from '../../bridges/compute/compute-types.gen';

import type { DocumentContext } from '../../context';
import { KernelError } from '../../errors';
import * as GroupingOps from './operations/grouping-operations';

/** Inline unwrap: throws KernelError on failure, returns data on success. */
function unwrapResult<T>(result: { success: boolean; data?: T; error?: any }): T {
  if (!result.success) {
    if (result.error instanceof KernelError) throw result.error;
    throw KernelError.from(
      result.error,
      'COMPUTE_ERROR',
      String(result.error?.message ?? result.error ?? 'Operation failed'),
    );
  }
  return result.data as T;
}

export class WorksheetOutlineImpl implements WorksheetOutline {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  async groupRows(startRow: number, endRow: number): Promise<void> {
    this._ensureWritable('outline.groupRows');
    unwrapResult(await GroupingOps.groupRows(this.ctx, this.sheetId, startRow, endRow));
  }

  async ungroupRows(startRow: number, endRow: number): Promise<void> {
    unwrapResult(await GroupingOps.ungroupRows(this.ctx, this.sheetId, startRow, endRow));
  }

  async groupColumns(startCol: number, endCol: number): Promise<void> {
    unwrapResult(await GroupingOps.groupColumns(this.ctx, this.sheetId, startCol, endCol));
  }

  async ungroupColumns(startCol: number, endCol: number): Promise<void> {
    unwrapResult(await GroupingOps.ungroupColumns(this.ctx, this.sheetId, startCol, endCol));
  }

  async toggleCollapsed(groupId: string): Promise<void> {
    unwrapResult(await GroupingOps.toggleGroupCollapsed(this.ctx, this.sheetId, groupId));
  }

  async setLevelCollapsed(axis: 'row' | 'column', level: number, collapsed: boolean): Promise<void> {
    this._ensureWritable('outline.setLevelCollapsed');
    await this.ctx.computeBridge.setLevelCollapsed(this.sheetId, axis, level, collapsed);
  }

  async expandAll(): Promise<void> {
    unwrapResult(await GroupingOps.expandAllGroups(this.ctx, this.sheetId));
  }

  async collapseAll(): Promise<void> {
    unwrapResult(await GroupingOps.collapseAllGroups(this.ctx, this.sheetId));
  }

  async getState(): Promise<GroupState> {
    return GroupingOps.getGroupState(this.ctx, this.sheetId);
  }

  async getLevel(type: 'row' | 'column', index: number): Promise<number> {
    return GroupingOps.getOutlineLevel(this.ctx, this.sheetId, type, index);
  }

  async getMaxLevel(type: 'row' | 'column'): Promise<number> {
    return GroupingOps.getMaxOutlineLevel(this.ctx, this.sheetId, type);
  }

  async subtotal(config: SubtotalConfig): Promise<SubtotalResult> {
    return unwrapResult(await GroupingOps.subtotal(this.ctx, this.sheetId, config));
  }

  async getSettings(): Promise<OutlineSettings> {
    const config = await this.ctx.computeBridge.getSheetGroupingConfig(this.sheetId);
    return {
      showOutlineSymbols: config.showOutlineSymbols,
      showOutlineLevelButtons: config.showOutlineLevelButtons,
      summaryRowsBelow: config.summaryRowsBelow,
      summaryColumnsRight: config.summaryColumnsRight,
    };
  }

  async setSettings(settings: Partial<OutlineSettings>): Promise<void> {
    await this.ctx.computeBridge.setOutlineSettings(this.sheetId, settings);
  }

  async showOutlineLevels(rowLevels: number, colLevels: number): Promise<void> {
    await Promise.all([
      this._showLevelsForAxis('row', rowLevels),
      this._showLevelsForAxis('column', colLevels),
    ]);
  }

  private async _showLevelsForAxis(axis: 'row' | 'column', targetLevel: number): Promise<void> {
    const groups = await this.ctx.computeBridge.getGroups(this.sheetId, axis);
    const toToggle = groups.filter((group: GroupDefinition) => {
      const shouldBeCollapsed = group.level > targetLevel;
      return group.collapsed !== shouldBeCollapsed;
    });
    await Promise.all(
      toToggle.map((group: GroupDefinition) =>
        this.ctx.computeBridge.toggleGroupCollapsed(this.sheetId, group.id),
      ),
    );
  }
}
