/**
 * WorkbookSheetsImpl — Implementation of the WorkbookSheets sub-API.
 *
 * Delegates to sheet-crud-operations and WorkbookDomain for actual operations.
 * Dependencies are injected from WorkbookImpl to avoid exposing internals.
 *
 * No JS-side sheet cache — all metadata reads go through Rust (single source of truth).
 */
import type {
  SheetHideReceipt,
  SheetMoveReceipt,
  SheetRemoveReceipt,
  SheetRenameReceipt,
  SheetShowReceipt,
  SheetsCollectionEventMap,
  Workbook,
  WorkbookInternal,
  WorkbookSheets,
  Worksheet,
} from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';
import { type CallableDisposable, toDisposable } from '@mog/spreadsheet-utils/disposable';
import { KernelError, toMogSdkError } from '../../errors';
import { protectedWorkbook } from '../../errors/api';

import type { ProtectedWorkbookOperation } from '@mog-sdk/contracts/protection';
import type { DocumentContext } from '../../context';
import { getOrder } from '../../domain/sheets/sheet-meta';
import * as WorkbookDomain from '../../domain/workbook/workbook';
import {
  createVersionMutationAdmissionOptions,
  type CreateVersionOperationContextInput,
  type VersionedMutationAdmissionOptions,
} from './version-operation-context';

import {
  copySheet,
  createSheet,
  moveSheet,
  removeSheet,
  renameSheet,
  setSheetHidden,
} from './operations/sheet-crud-operations';
import { EVENT_TO_INTERNAL } from './event-mapping';

type SheetCrudMutationOptions = VersionedMutationAdmissionOptions;

/**
 * Dependencies injected from WorkbookImpl.
 */
export interface WorkbookSheetsDeps {
  ctx: DocumentContext;
  /** Resolve a target (number | string) to a sheetId. ASYNC — reads from Rust. */
  resolveTarget: (target: number | string) => Promise<SheetId>;
  /** Get sheet name by sheetId. ASYNC — reads from Rust. */
  getSheetName: (sheetId: SheetId) => Promise<string | undefined>;
  /** Get the current sheet count. ASYNC — reads from Rust. */
  getSheetCount: () => Promise<number>;
  /** Set the active sheet ID. */
  setActiveSheetId: (sheetId: SheetId) => void;
  /** Reference to the parent Workbook (for WorksheetImpl constructor). */
  workbook: Workbook;
}

export class WorkbookSheetsImpl implements WorkbookSheets {
  constructor(private readonly deps: WorkbookSheetsDeps) {}

  /**
   * Guard: throws WriteGateError if the document is not writable (the write gate).
   */
  private _ensureWritable(operation: string): void {
    try {
      this.deps.ctx.writeGate.assertWritable(operation);
    } catch (err) {
      throw toMogSdkError(err, operation);
    }
  }

  /**
   * Throws if the workbook is protected and the given operation is not allowed.
   */
  private async ensureWorkbookOpAllowed(operation: ProtectedWorkbookOperation): Promise<void> {
    const allowed = await WorkbookDomain.isOperationAllowed(this.deps.ctx, operation);
    if (!allowed) {
      throw protectedWorkbook(operation);
    }
  }

  async add(name?: string, index?: number): Promise<Worksheet> {
    this._ensureWritable('sheets.add');
    await this.ensureWorkbookOpAllowed('addSheet');
    const { ctx, workbook } = this.deps;
    // Pass name to Rust as-is. When empty/undefined, Rust auto-generates
    // a unique "SheetN" name by checking existing sheet names atomically.
    const sheetName = name ?? '';

    const createOptions =
      index !== undefined
        ? createGroupedSheetCrudMutationOptions(ctx, {
            operationIdPrefix: 'workbook.sheets.add',
            domainIds: ['sheets'],
          })
        : createSheetCrudMutationOptions(ctx, {
            operationIdPrefix: 'workbook.sheets.add',
            domainIds: ['sheets'],
          });
    const newSheetId = await createSheet(ctx, sheetName, createOptions);

    // If a specific index was requested, move the sheet there
    if (index !== undefined) {
      const order = await getOrder(ctx);
      const currentIndex = order.indexOf(newSheetId);
      if (currentIndex !== index && index >= 0 && index < order.length) {
        await moveSheet(
          ctx,
          newSheetId,
          index,
          createSheetCrudMutationOptions(ctx, {
            operationIdPrefix: 'workbook.sheets.add.move',
            sheetIds: [newSheetId],
            domainIds: ['sheets'],
            groupId: createOptions.operationContext.groupId,
          }),
        );
      }
    }

    // Read the resolved name from Rust (may have been auto-generated).
    const resolvedName = sheetName || (await this.deps.getSheetName(newSheetId)) || sheetName;

    // Register via the workbook's instance cache so it's the same object getSheet() returns
    const ws = (workbook as WorkbookInternal)._getOrCreateWorksheet(
      newSheetId,
      resolvedName,
    ) as Worksheet;
    // Sync cached sheet metadata so sheetNames/sheetCount reflect the new sheet
    await (workbook as WorkbookInternal).refreshSheetMetadata();

    // Make the new sheet active (matches Excel/Google Sheets behavior)
    this.deps.setActiveSheetId(newSheetId);
    ctx.eventBus.emit({
      type: 'sheet:activated',
      timestamp: Date.now(),
      sheetId: newSheetId,
      name: resolvedName,
      source: 'user',
    });

    return ws;
  }

  async remove(target: number | string): Promise<SheetRemoveReceipt> {
    this._ensureWritable('sheets.remove');
    await this.ensureWorkbookOpAllowed('deleteSheet');
    const { ctx, resolveTarget, getSheetName, getSheetCount } = this.deps;
    const sheetId = await resolveTarget(target);
    const removedName = (await getSheetName(sheetId)) ?? String(target);

    // Before deleting, check if this is the last visible sheet.
    // If so, auto-unhide a hidden sheet to prevent a UI deadlock (Excel behavior).
    const allSheetIds = await getOrder(ctx);
    const visibilityFlags = await Promise.all(
      allSheetIds.map((id) => ctx.computeBridge.isSheetHidden(id)),
    );
    const visibleIds = allSheetIds.filter((_, i) => !visibilityFlags[i]);
    if (visibleIds.length === 1 && visibleIds[0] === sheetId) {
      const firstHiddenId = allSheetIds.find((_, i) => visibilityFlags[i]);
      if (firstHiddenId) {
        await setSheetHidden(ctx, firstHiddenId, false);
        const newActiveName = (await getSheetName(firstHiddenId)) ?? '';
        this.deps.setActiveSheetId(firstHiddenId);
        ctx.eventBus.emit({
          type: 'sheet:activated',
          timestamp: Date.now(),
          sheetId: firstHiddenId,
          name: newActiveName,
          source: 'user',
        });
      } else {
        throw new KernelError(
          'COMPUTE_ERROR',
          'Cannot delete the last sheet. A workbook must have at least one sheet.',
        );
      }
    }

    const deleted = await removeSheet(
      ctx,
      sheetId,
      createSheetCrudMutationOptions(ctx, {
        operationIdPrefix: 'workbook.sheets.remove',
        sheetIds: [sheetId],
        domainIds: ['sheets'],
      }),
    );
    if (!deleted) {
      throw new KernelError(
        'COMPUTE_ERROR',
        'Cannot delete the last sheet. A workbook must have at least one sheet.',
      );
    }
    const remainingCount = await getSheetCount();
    // Sync cached sheet metadata so sheetNames/sheetCount reflect the removal
    await (this.deps.workbook as WorkbookInternal).refreshSheetMetadata();
    return { kind: 'sheetRemove', removedName, remainingCount };
  }

  async move(target: number | string, toIndex: number): Promise<SheetMoveReceipt> {
    this._ensureWritable('sheets.move');
    await this.ensureWorkbookOpAllowed('moveSheet');
    const { ctx, resolveTarget, getSheetName } = this.deps;
    const sheetId = await resolveTarget(target);
    const name = (await getSheetName(sheetId)) ?? String(target);
    const moved = await moveSheet(
      ctx,
      sheetId,
      toIndex,
      createSheetCrudMutationOptions(ctx, {
        operationIdPrefix: 'workbook.sheets.move',
        sheetIds: [sheetId],
        domainIds: ['sheets'],
      }),
    );
    if (!moved) {
      throw new KernelError('COMPUTE_ERROR', `Failed to move sheet "${name}" to index ${toIndex}.`);
    }
    // Sync cached sheet metadata so sheetNames order reflects the move
    await (this.deps.workbook as WorkbookInternal).refreshSheetMetadata();
    return { kind: 'sheetMove', name, newIndex: toIndex };
  }

  async rename(target: number | string, newName: string): Promise<SheetRenameReceipt> {
    this._ensureWritable('sheets.rename');
    await this.ensureWorkbookOpAllowed('renameSheet');
    const { ctx, resolveTarget, getSheetName, workbook } = this.deps;
    const sheetId = await resolveTarget(target);
    const oldName = (await getSheetName(sheetId)) ?? String(target);

    // Validate: no other sheet may have this name (case-insensitive, Excel semantics)
    await assertNameNotTaken(ctx, newName, sheetId);

    await renameSheet(
      ctx,
      sheetId,
      newName,
      createSheetCrudMutationOptions(ctx, {
        operationIdPrefix: 'workbook.sheets.rename',
        sheetIds: [sheetId],
        domainIds: ['sheets'],
      }),
    );
    // Sync cached worksheet metadata so getName() reflects the new name
    await (workbook as WorkbookInternal).refreshSheetMetadata();
    return { kind: 'sheetRename', oldName, newName };
  }

  async setActive(target: number | string): Promise<void> {
    const { ctx, resolveTarget, setActiveSheetId, getSheetName, workbook } = this.deps;
    const sheetId = await resolveTarget(target);
    // Pre-create the worksheet instance with its name so activeSheet returns correct metadata
    const name = await getSheetName(sheetId);
    (workbook as WorkbookInternal)._getOrCreateWorksheet(sheetId, name);
    setActiveSheetId(sheetId);
    // Sync all worksheet instances' metadata
    await (workbook as WorkbookInternal).refreshSheetMetadata();
    // Emit sheet:activated event
    ctx.eventBus.emit({
      type: 'sheet:activated',
      timestamp: Date.now(),
      sheetId,
      name: name ?? '',
      source: 'user',
    });
  }

  async copy(source: number | string, newName?: string, index?: number): Promise<Worksheet> {
    this._ensureWritable('sheets.copy');
    await this.ensureWorkbookOpAllowed('copySheet');
    const { ctx, resolveTarget, getSheetName, workbook } = this.deps;
    const sourceId = await resolveTarget(source);
    const sourceName = await getSheetName(sourceId);
    const copyName = newName ?? `${sourceName ?? 'Sheet'} (Copy)`;

    const copyOptions =
      index !== undefined
        ? createGroupedSheetCrudMutationOptions(ctx, {
            operationIdPrefix: 'workbook.sheets.copy',
            sheetIds: [sourceId],
            domainIds: ['sheets'],
          })
        : createSheetCrudMutationOptions(ctx, {
            operationIdPrefix: 'workbook.sheets.copy',
            sheetIds: [sourceId],
            domainIds: ['sheets'],
          });
    const newSheetId = await copySheet(ctx, sourceId, copyName, copyOptions);

    if (!newSheetId) {
      throw new KernelError('COMPUTE_ERROR', `Failed to copy sheet. Source sheet may not exist.`);
    }

    if (index !== undefined) {
      const order = await getOrder(ctx);
      const currentIndex = order.indexOf(newSheetId);
      const targetIndex = Math.max(0, Math.min(index, order.length - 1));
      if (currentIndex !== -1 && currentIndex !== targetIndex) {
        await moveSheet(
          ctx,
          newSheetId,
          targetIndex,
          createSheetCrudMutationOptions(ctx, {
            operationIdPrefix: 'workbook.sheets.copy.move',
            sheetIds: [newSheetId],
            domainIds: ['sheets'],
            groupId: copyOptions.operationContext.groupId,
          }),
        );
      }
    }

    // Register via the workbook's instance cache so it's the same object getSheet() returns
    const ws = (workbook as WorkbookInternal)._getOrCreateWorksheet(
      newSheetId,
      copyName,
    ) as Worksheet;
    // Sync cached sheet metadata so sheetNames/sheetCount reflect the copy
    await (workbook as WorkbookInternal).refreshSheetMetadata();
    return ws;
  }

  async hide(target: number | string): Promise<SheetHideReceipt> {
    this._ensureWritable('sheets.hide');
    await this.ensureWorkbookOpAllowed('hideSheet');
    const { ctx, resolveTarget, getSheetName, workbook } = this.deps;
    const sheetId = await resolveTarget(target);
    const name = (await getSheetName(sheetId)) ?? String(target);

    // Excel parity: cannot hide the last visible sheet.
    // Only enforce this check when the target sheet is currently visible.
    const currentVisibility = await ctx.computeBridge.getSheetVisibility(sheetId);
    if (currentVisibility !== 'hidden' && currentVisibility !== 'veryHidden') {
      const visibleCount = await ctx.computeBridge.countVisibleSheets();
      if (visibleCount <= 1) {
        throw new KernelError(
          'COMPUTE_ERROR',
          `Failed to hide sheet. Cannot hide the last visible sheet.`,
        );
      }
    }

    const success = await setSheetHidden(ctx, sheetId, true);
    if (!success) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Failed to hide sheet. Cannot hide the last visible sheet.`,
      );
    }
    // Sync cached worksheet metadata so getVisibility() reflects the new state
    await (workbook as WorkbookInternal).refreshSheetMetadata();
    return { kind: 'sheetHide', name };
  }

  async show(target: number | string): Promise<SheetShowReceipt> {
    this._ensureWritable('sheets.show');
    await this.ensureWorkbookOpAllowed('unhideSheet');
    const { ctx, resolveTarget, getSheetName, workbook } = this.deps;
    const sheetId = await resolveTarget(target);
    const name = (await getSheetName(sheetId)) ?? String(target);
    const success = await setSheetHidden(ctx, sheetId, false);
    if (!success) {
      throw new KernelError('COMPUTE_ERROR', `Failed to show sheet.`);
    }
    // Sync cached worksheet metadata so getVisibility() reflects the new state
    await (workbook as WorkbookInternal).refreshSheetMetadata();
    return { kind: 'sheetShow', name };
  }

  async setSelectedIds(sheetIds: SheetId[]): Promise<void> {
    await WorkbookDomain.setSelectedSheetIds(this.deps.ctx, sheetIds);
  }

  on<K extends keyof SheetsCollectionEventMap>(
    event: K,
    handler: (event: SheetsCollectionEventMap[K]) => void,
  ): CallableDisposable;
  on(event: string, handler: (event: unknown) => void): CallableDisposable;
  on(event: string, handler: (event: any) => void): CallableDisposable {
    const internalTypes = EVENT_TO_INTERNAL[event];
    if (!internalTypes) {
      console.warn(
        `[WorkbookSheets.on] Unknown event "${event}". ` +
          `Known events: ${Object.keys(EVENT_TO_INTERNAL).join(', ')}.`,
      );
      return toDisposable(() => {});
    }

    const unsubs = internalTypes.map((type) => this.deps.ctx.eventBus.on(type, handler));
    return toDisposable(() => {
      for (const u of unsubs) u();
    });
  }
}

// =============================================================================
// Validation helpers
// =============================================================================

/**
 * Throw if any *other* sheet already uses this name (case-insensitive).
 * Renaming a sheet to its own current name (possibly with different casing) is allowed.
 */
async function assertNameNotTaken(
  ctx: DocumentContext,
  name: string,
  currentSheetId: SheetId | string,
): Promise<void> {
  const nameLower = name.toLowerCase();
  const order = await getOrder(ctx);
  for (const id of order) {
    if (id === currentSheetId) continue; // skip the sheet being renamed
    const existing = await ctx.computeBridge.getSheetName(id);
    if (existing != null && existing.toLowerCase() === nameLower) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `A sheet named "${name}" already exists. Sheet names must be unique (case-insensitive).`,
      );
    }
  }
}

function createSheetCrudMutationOptions(
  ctx: DocumentContext,
  input: CreateVersionOperationContextInput,
): SheetCrudMutationOptions {
  return createVersionMutationAdmissionOptions(ctx, input);
}

function createGroupedSheetCrudMutationOptions(
  ctx: DocumentContext,
  input: CreateVersionOperationContextInput,
): SheetCrudMutationOptions {
  const options = createSheetCrudMutationOptions(ctx, input);
  return {
    operationContext: {
      ...options.operationContext,
      groupId: options.operationContext.groupId ?? options.operationContext.operationId,
    },
  };
}
