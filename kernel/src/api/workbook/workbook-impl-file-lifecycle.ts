/**
 * WorkbookImpl — Unified Workbook Implementation
 *
 * THE single implementation of the Workbook interface. Every consumer —
 * headless agents, LLM code, OS apps, browser app — uses this.
 *
 * Absorbs functionality from:
 * - SpreadsheetAPI (kernel/src/api/spreadsheet-api.ts)
 * - External API WorkbookImpl (kernel/src/external/workbook.ts)
 *
 * Design decisions:
 * 1. getSheetById(sheetId) is SYNC — constructs WorksheetImpl directly.
 *    getSheet/getSheetByIndex are ASYNC — reads from Rust.
 *    No JS-side sheet cache. Rust is the single source of truth.
 * 2. canUndo()/canRedo() are SYNC — delegated to UndoService's cached state.
 * 3. undoGroup() wraps operations in beginUndoGroup/endUndoGroup for undo grouping.
 *    Each mutation triggers its own recalc — no deferred calc accumulation.
 * 4. Errors are thrown, not returned as OperationResult. This is simpler
 *    for LLM code generation (try/catch beats checking .success).
 *
 * @see contracts/src/api/workbook.ts — Interface definition
 */

import type {
  CalculateOptions,
  CalculateResult,
  CheckpointInfo,
  CodeResult,
  InsertWorksheetOptions,
  ExecuteOptions,
  ScreenshotOptions,
  SearchOptions,
  SearchResult,
  FilterExpression,
  FunctionInfo,
  IRecordsAPI,
  RecordValues,
  SheetRangeDescribeResult,
  SheetRangeRequest,
  Workbook,
  WorkbookEvent,
  WorkbookXlsxExportOptions,
  WorkbookInternal,
  WorkbookSettings,
  WorkbookSettingsPatch,
  WorkbookSnapshot,
  CustomList,
  WorkbookCustomListInput,
  WorkbookCustomListUpdate,
  WorkbookLinks,
  WorkbookLinkStatusScope,
  Worksheet,
  WorksheetWithInternals,
} from '@mog-sdk/contracts/api';
import type { CultureInfo } from '@mog-sdk/contracts/culture';
import type { IChartBridge, IInkRecognitionBridge, IPivotBridge } from '@mog-sdk/contracts/bridges';
import { type CellValuePrimitive, type SheetId, sheetId } from '@mog-sdk/contracts/core';
import { toRowId as toSpreadsheetRowId } from '@mog-sdk/contracts/cell-identity';
import {
  type CallableDisposable,
  DisposableStore,
  toDisposable,
} from '@mog/spreadsheet-utils/disposable';
import type { DocumentImportWarning } from '@mog-sdk/contracts/document';
import { materializeExternalFormulas } from '../../services/external-formulas';
import { slog } from '../../lib/slog';
import type {
  EventByType,
  IEventBus,
  SpreadsheetEventType as InternalEventType,
  SpreadsheetEvent as InternalSpreadsheetEvent,
} from '@mog-sdk/contracts/events';
import { KernelError } from '../../errors';
import type {
  MutationResultWithSheetLifecycleRuntimeHint,
  SheetRuntimeAdapterContext,
} from '../../bridges/mutation-result-handler';

import type { SelectionCheckpoint } from '@mog-sdk/contracts/selection';
import type { IKernelServices } from '@mog-sdk/contracts/services';

import type { IFloatingObjectManager } from '@mog-sdk/contracts/kernel';
import type { AccessPrincipal } from '@mog-sdk/contracts/security';

import type { DocumentContext } from '../../context';
import { FormControlManager } from '../../domain/form-controls';
import { getName, getOrder } from '../../domain/sheets/sheet-meta';
import { DEFAULT_CALCULATION_SETTINGS } from '../../domain/workbook/core-defaults';
import { toComputeWorkbookSettings } from '../../domain/workbook/workbook-settings-wire';
import type { SpreadsheetObjectManager } from '../../floating-objects';
import { createCheckpointManager } from '../../services/checkpoint';
import type { ICheckpointManager } from '../../services/checkpoint';
import type { CheckoutSnapshotApplyInput } from '../../document/version-store/checkout-apply';
import type { SnapshotRootFreshLifecycleMaterialization } from '../document/snapshot-root-lifecycle-hydrator';
import {
  getFunctionCatalog as getCatalog,
  getFunctionInfo as getInfo,
  getWorkbookSnapshot as getSnapshot,
} from '../internal/introspection';
import { parseCellAddress, parseCellRange, toA1 } from '../internal/utils';
import * as Records from '../namespaces/records';
import { formatDescribeRange } from '../worksheet/operations/describe-operations';
import { WorksheetImpl } from '../worksheet/worksheet-impl';

// Shared workbook types — extracted to avoid impl↔barrel cycle.
import type {
  CodeExecutorFactory,
  CodeExecutorType,
  CreateWorkbookOptions,
  WorkbookConfig,
} from './types';
import {
  attachWorkbookVersioning,
  attachWorkbookVersionSurfaceStatusService,
} from './version-wiring';
import { rebindVersioningAfterCheckout } from './version/checkout/version-checkout-rebind';
import { readVersionLiveCollaborationStatus } from './version/live-collaboration/version-live-collaboration-status';
import { readVersionPendingProviderWrites } from './version/pending/provider-writes';
import {
  getKnownSheetNames,
  resolveSheetNameToId as resolveWorkbookSheetNameToId,
  resolveSheetTarget,
} from './sheet-lookup';
import {
  createSaveCallbackFailedError,
  createSaveWriteFailedError,
  createSaveWriterUnavailableError,
  normalizeWorkbookSavePath,
} from './save-errors';
import { assertWorkbookXlsxExportDomainSupportManifest } from './export-errors';
import { removeCleanExportBlockedPackageInventoryFromXlsx } from './xlsx-clean-export-package';
import { maybeAddMogVersionMetadataToXlsx } from './version/xlsx-metadata/xlsx-version-metadata';
export type { CreateWorkbookOptions, WorkbookConfig } from './types';

// Event mapping — extracted to `event-mapping.ts` so `sheets.ts` can import it
// without going through the barrel (which would re-introduce the cycle).
import { EVENT_TO_INTERNAL } from './event-mapping';
export { EVENT_TO_INTERNAL } from './event-mapping';

// Sub-API imports — imported directly from each module (NOT through `./index`)
// to keep the impl→barrel→impl cycle broken.
import type {
  WorkbookCellStyles,
  WorkbookChanges,
  WorkbookDiagnostics,
  WorkbookFunctions,
  WorkbookHistory,
  WorkbookVersion,
  WorkbookNames,
  WorkbookNotifications,
  WorkbookPivotTableStyles,
  WorkbookProperties,
  WorkbookProtection,
  WorkbookScenarios,
  WorkbookSecurity,
  WorkbookSheets,
  WorkbookSlicerStyles,
  WorkbookSlicers,
  WorkbookStateProvider,
  WorkbookTableStyles,
  WorkbookTheme,
  WorkbookTimelineStyles,
  WorkbookViewport,
} from '@mog-sdk/contracts/api';
import { WorkbookHistoryImpl } from './history';
import {
  WorkbookVersionWithDirtyTracking,
  type WorkbookVersionDirtyTrackingState,
} from './workbook-version-dirty-tracking';
import { WorkbookNamesImpl } from './names';
import { WorkbookNotificationsImpl } from './notifications';
import { WorkbookPropertiesImpl } from './properties';
import { WorkbookProtectionImpl } from './protection';
import { WorkbookScenariosImpl } from './scenarios';
import { WorkbookSheetsImpl } from './sheets';
import { WorkbookSlicerStylesImpl } from './slicer-styles';
import { WorkbookSlicersImpl } from './slicers';
import { WorkbookTimelineStylesImpl } from './timeline-styles';
import { WorkbookTableStylesImpl } from './table-styles';
import { WorkbookCellStylesImpl } from './cell-styles';
import { WorkbookThemeImpl } from './theme';
import { WorkbookPivotTableStylesImpl } from './pivot-styles';
import { WorkbookFunctionsImpl } from './functions';
import { WorkbookSecurityImpl } from './security';
import { WorkbookViewportImpl } from './viewport';
import { WorkbookChangesImpl } from './changes';
import { WorkbookDiagnosticsImpl } from './diagnostics';
import { WorkbookLinksImpl } from './links';
import { createWorkbookContextBinding, type WorkbookContextBinding } from './context-binding';
import { reconcileCheckoutActiveSheet } from './version/checkout/version-checkout-materializer-active-sheet';
import { createWorkbookVersionSurfaceStatusService } from './version/surface-status/version-surface-status-service';
import {
  applyWorkbookReadOnlyMode,
  createWorkbookFeatureGateBinder,
  createWorkbookStateProvider,
  type WorkbookFeatureGateBinder,
} from './workbook-construction-config';
import { createWorkbookCheckoutTransactionCoordinator } from './workbook-checkout-transactions';
import { createWorkbookLiveness } from './workbook-liveness';
import { resolveWorkbookImportWarnings } from './workbook-import-warnings';
import { withDefaultWorkbookCheckoutMaterializer } from './workbook-versioning-assembly';

import { DEFAULT_CHROME_THEME } from '@mog-sdk/contracts/rendering';
import { NO_HOST_OPERATION_GATE, OperationDeniedError } from '../../document/host-operation-gate';
import type {
  HostExportContentPolicy,
  KernelDocumentHighWaterMarkProof,
} from '@mog-sdk/types-host/kernel';
import { createHostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import type { HandleLiveness } from '../lifecycle/handle-liveness';

// =============================================================================
// WorkbookImpl File and Lifecycle
// =============================================================================

import { WorkbookImplOperations } from './workbook-impl-operations';

export abstract class WorkbookImplFileLifecycle extends WorkbookImplOperations {
  abstract get version(): WorkbookVersion;

  // ===========================================================================
  // Import / Export
  // ===========================================================================

  async toXlsx(options?: WorkbookXlsxExportOptions): Promise<Uint8Array> {
    this._ensureNotDisposed();
    await this.ctx.awaitMaterialized?.('allSheets');
    await assertWorkbookXlsxExportDomainSupportManifest(this.ctx);

    // Host-backed path: export requires authorization through the operation gate.
    const gate = this.ctx.operationGate;
    if (gate !== NO_HOST_OPERATION_GATE) {
      const exportPathId = 'workbook.toXlsx';
      const destination = 'download';
      const format = 'xlsx';
      const highWaterMark = this.ctx.writeGate.captureHighWaterMark();
      const rawMaterializationProof = {
        source: 'rust-policy-engine' as const,
        decisionId: `raw-export-${Date.now()}`,
        sessionId: `kernel-export-${Date.now()}`,
        principalFingerprint: createHostCanonicalFingerprint({
          exportPathId,
          format,
          principal: 'active-kernel-session',
        }),
        resourceContextFingerprint: createHostCanonicalFingerprint({
          exportPathId,
          format,
          destination,
        }),
        target: 'raw-document-materialization' as const,
        scope: 'entire-document' as const,
        effectiveLevel: 'raw-materialize' as const,
        childPolicyResolution: 'all-materialized-targets-raw-authorized' as const,
        correlationId: `export-${Date.now()}`,
        issuedAt: Date.now(),
      };
      const contentPolicy: HostExportContentPolicy = {
        kind: 'authorized-raw-snapshot',
        rawMaterializationProof,
      };
      const proofPayload = {
        source: 'kernel-write-gate',
        mutationWatermark: String(highWaterMark.mutationWatermark),
        exportPathId,
        format,
        destination,
        requestedExportSinkRefs: [],
        contentPolicy,
      };
      const documentHighWaterMark: KernelDocumentHighWaterMarkProof = {
        source: 'kernel-write-gate',
        proofId: `export-proof-${Date.now()}`,
        registryId: 'kernel-workbook-export',
        sessionId: rawMaterializationProof.sessionId,
        resourceContextFingerprint: rawMaterializationProof.resourceContextFingerprint,
        mutationWatermark: String(highWaterMark.mutationWatermark),
        exportPathId,
        format,
        contentPolicyFingerprint: createHostCanonicalFingerprint(contentPolicy),
        destination,
        requestedExportSinkRefs: [],
        issuedAt: Date.now(),
        expiresAt: Date.now() + 30_000,
        coveredFields: [
          'proofId',
          'registryId',
          'sessionId',
          'resourceContextFingerprint',
          'mutationWatermark',
          'exportPathId',
          'format',
          'contentPolicyFingerprint',
          'destination',
          'requestedExportSinkRefs',
          'issuedAt',
          'expiresAt',
        ],
        canonicalPayloadHash: createHostCanonicalFingerprint(proofPayload),
        verification: {
          kind: 'live-kernel-write-gate-registry',
          registryId: 'kernel-workbook-export',
        },
      };
      await gate.authorizeExport({
        format,
        destination,
        exportPathId,
        documentHighWaterMark,
        requestedExportSinkRefs: [],
        contentPolicy,
      });
    }

    const bridge = this.ctx.computeBridge as typeof this.ctx.computeBridge & {
      exportToXlsxBytesContextStripped?: () => Promise<Uint8Array>;
    };
    if (options?.contextStripped) {
      if (!bridge.exportToXlsxBytesContextStripped) {
        throw new Error('context-stripped XLSX export is not available on this compute bridge');
      }
      const bytes = await bridge.exportToXlsxBytesContextStripped();
      return maybeAddMogVersionMetadataToXlsx(
        this.ctx,
        this.version,
        await removeCleanExportBlockedPackageInventoryFromXlsx(bytes),
        options,
      );
    }
    const bytes = await this.ctx.computeBridge.exportToXlsxBytes();
    return maybeAddMogVersionMetadataToXlsx(
      this.ctx,
      this.version,
      await removeCleanExportBlockedPackageInventoryFromXlsx(bytes),
      options,
    );
  }

  async insertWorksheets(
    data: string | Uint8Array,
    options?: InsertWorksheetOptions,
  ): Promise<string[]> {
    this._ensureWritable('workbook.insertWorksheets');
    let bytes: Uint8Array;
    if (typeof data === 'string') {
      // Decode base64 to Uint8Array
      const binaryString = atob(data);
      bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
    } else {
      bytes = data;
    }

    const insertPosition = await this._resolveInsertPosition(options);
    const insertedNames = await this.ctx.computeBridge.importSheetsFromXlsx(
      bytes,
      options?.sheetNamesToInsert ?? [],
      insertPosition,
    );
    await this.refreshSheetMetadata();
    return insertedNames;
  }

  private async _resolveInsertPosition(options?: InsertWorksheetOptions): Promise<number | null> {
    if (!options?.positionType || options.positionType === 'end') return null;

    switch (options.positionType) {
      case 'beginning':
        return 0;
      case 'before':
      case 'after': {
        if (!options.relativeTo) {
          throw new KernelError(
            'COMPUTE_ERROR',
            `'relativeTo' is required when positionType is '${options.positionType}'`,
          );
        }
        const ws = await this.getSheet(options.relativeTo);
        const idx = ws.getIndex();
        return options.positionType === 'before' ? idx : idx + 1;
      }
      default:
        return null;
    }
  }

  async captureScreenshot(
    sheet: Worksheet | string,
    range: string,
    options?: ScreenshotOptions,
  ): Promise<Uint8Array> {
    const sheetName = typeof sheet === 'string' ? sheet : sheet.name;
    const sid = await this._resolveTarget(sheetName);
    const parsed = parseCellRange(range);
    if (!parsed) {
      throw new KernelError('API_INVALID_ADDRESS', `Invalid cell range: "${range}"`, {
        context: { range },
      });
    }
    return this.ctx.computeBridge.captureScreenshot(
      sid,
      parsed.startRow,
      parsed.startCol,
      parsed.endRow,
      parsed.endCol,
      options?.dpr ?? 1,
      options?.showHeaders ?? true,
      options?.showGridlines ?? true,
      options?.maxWidth ?? null,
      options?.maxHeight ?? null,
    );
  }

  // ===========================================================================
  // Cross-workbook
  // ===========================================================================

  async copyRangeFrom(
    source: Workbook,
    fromRange: string,
    toRange: string,
    options?: { fromSheet?: string | Worksheet; toSheet?: string | Worksheet },
  ): Promise<void> {
    this._ensureWritable('workbook.copyRangeFrom');
    // Resolve source sheet
    let sourceSheet: Worksheet;
    if (options?.fromSheet) {
      sourceSheet =
        typeof options.fromSheet === 'string'
          ? await source.getSheet(options.fromSheet)
          : options.fromSheet;
    } else {
      sourceSheet = source.activeSheet;
    }

    // Resolve target sheet
    let targetSheet: Worksheet;
    if (options?.toSheet) {
      targetSheet =
        typeof options.toSheet === 'string'
          ? await this.getSheet(options.toSheet)
          : options.toSheet;
    } else {
      targetSheet = this.activeSheet;
    }

    const srcBounds = parseCellRange(fromRange);
    const tgtBounds = parseCellRange(toRange);
    if (!srcBounds) throw new KernelError('COMPUTE_ERROR', `Invalid source range: "${fromRange}"`);
    if (!tgtBounds) throw new KernelError('COMPUTE_ERROR', `Invalid target range: "${toRange}"`);

    const srcData = await sourceSheet.getRange(fromRange);

    await this.undoGroup(async () => {
      // Write values/formulas cell by cell (formulas start with '=' and
      // are parsed by Rust automatically via setCell)
      for (let r = 0; r < srcData.length; r++) {
        for (let c = 0; c < srcData[r].length; c++) {
          const cell = srcData[r][c];
          if (!cell) continue;
          const targetRow = tgtBounds.startRow + r;
          const targetCol = tgtBounds.startCol + c;
          const rawValue = cell.formula ?? cell.value ?? null;
          if (rawValue !== null) {
            // CellError objects can't be written directly — skip error cells
            // (they'll be recomputed if we're copying the formula)
            const writeValue =
              typeof rawValue === 'object' &&
              rawValue !== null &&
              'type' in rawValue &&
              (rawValue as any).type === 'error'
                ? null
                : rawValue;
            if (writeValue !== null) {
              await targetSheet.setCell(targetRow, targetCol, writeValue as CellValuePrimitive);
            }
          }
          // Copy format if present
          if (cell.format) {
            await targetSheet.formats.set(targetRow, targetCol, cell.format);
          }
        }
      }
    });
  }

  // ===========================================================================
  // Utilities (sync)
  // ===========================================================================

  indexToAddress(row: number, col: number): string {
    return toA1(row, col);
  }

  addressToIndex(address: string): { row: number; col: number } {
    const parsed = parseCellAddress(address);
    if (!parsed) {
      throw new KernelError('COMPUTE_ERROR', `Invalid cell address: "${address}"`);
    }
    return { row: parsed.row, col: parsed.col };
  }

  union(...ranges: string[]): string {
    if (ranges.length === 0) {
      throw new KernelError('COMPUTE_ERROR', 'union() requires at least one range');
    }
    for (const r of ranges) {
      if (!parseCellRange(r)) {
        throw new KernelError('COMPUTE_ERROR', `Invalid range address: "${r}"`);
      }
    }
    return ranges.join(',');
  }

  // ===========================================================================
  // Culture & Locale
  // ===========================================================================

  async getCultureInfo(): Promise<CultureInfo> {
    if (this._cachedCultureInfo) return this._cachedCultureInfo;
    const settings = await this.ctx.computeBridge.getWorkbookSettings();
    const cultureTag = settings.culture ?? 'en-US';
    const { getCulture } = await import('@mog/culture');
    this._cachedCultureInfo = getCulture(cultureTag);
    return this._cachedCultureInfo;
  }

  async getDecimalSeparator(): Promise<string> {
    const culture = await this.getCultureInfo();
    return culture.decimalSeparator;
  }

  async getThousandsSeparator(): Promise<string> {
    const culture = await this.getCultureInfo();
    return culture.thousandsSeparator;
  }

  async searchAllSheets(
    patterns: string[],
    options?: SearchOptions,
  ): Promise<Array<SearchResult & { sheetName: string }>> {
    let rangeBounds:
      | { startRow: number; startCol: number; endRow: number; endCol: number }
      | undefined;
    if (options?.range) {
      const { parseCellRange } = await import('@mog/spreadsheet-utils/a1');
      const parsed = parseCellRange(options.range);
      if (parsed) rangeBounds = parsed;
    }
    const result = await this.ctx.computeBridge.regexSearchAllSheets({
      patterns,
      caseSensitive: options?.matchCase ?? false,
      wholeCell: options?.entireCell ?? false,
      includeFormulas: options?.searchFormulas ?? false,
      ...rangeBounds,
    });
    return result.matches.map((m) => ({
      address: m.address,
      value: m.value,
      sheetName: m.sheetName,
    }));
  }

  // ===========================================================================
  // Workbook Settings
  // ===========================================================================

  async getSettings(): Promise<WorkbookSettings> {
    // route through `ctx.mirror` — no Rust IPC.
    // The mirror is populated by `MutationResultHandler.applyAndNotify`
    // (incl. hydration's first MutationResult per `mutation-result-coverage-rust.md`),
    // so this read is correct on first paint.
    return this.ctx.mirror.getWorkbookSettings();
  }

  async setSettings(updates: WorkbookSettingsPatch): Promise<void> {
    this._ensureWritable('workbook.setSettings');
    this._cachedCalcMode = null;
    this._cachedCultureInfo = null;
    // For workbook-level state mirror reads: workbook
    // settings now ride the MutationResult.workbookSettingsChanges channel.
    // The TS-side manual re-read + per-key emit that lived here was removed
    // when the Rust contract (commit 8747f39e3) shipped per-key change
    // metadata; MutationResultHandler.handleWorkbookSettingsChanges is the
    // single emission point. Per ARCHITECTURE-CHECKLIST §14 — replace the
    // old emission path with the new normalized one in the same change.
    await this.ctx.computeBridge.patchWorkbookSettings(updates);
  }

  async replaceSettings(settings: WorkbookSettings): Promise<void> {
    this._ensureWritable('workbook.replaceSettings');
    this._cachedCalcMode = null;
    this._cachedCultureInfo = null;
    await this.ctx.computeBridge.setWorkbookSettings(toComputeWorkbookSettings(settings));
  }

  async getCustomLists(): Promise<readonly CustomList[]> {
    const { getCustomLists } = await import('../../domain/workbook/workbook');
    return getCustomLists(this.ctx);
  }

  async addCustomList(input: WorkbookCustomListInput): Promise<CustomList> {
    this._ensureWritable('workbook.addCustomList');
    const { addCustomList } = await import('../../domain/workbook/workbook');
    return addCustomList(this.ctx, input.name, [...input.values]);
  }

  async updateCustomList(id: string, updates: WorkbookCustomListUpdate): Promise<boolean> {
    this._ensureWritable('workbook.updateCustomList');
    const { updateCustomList } = await import('../../domain/workbook/workbook');
    return updateCustomList(this.ctx, id, {
      ...(updates.name !== undefined ? { name: updates.name } : {}),
      ...(updates.values !== undefined ? { values: [...updates.values] } : {}),
    });
  }

  async deleteCustomList(id: string): Promise<boolean> {
    this._ensureWritable('workbook.deleteCustomList');
    const { deleteCustomList } = await import('../../domain/workbook/workbook');
    return deleteCustomList(this.ctx, id);
  }

  async setCustomLists(lists: readonly WorkbookCustomListInput[]): Promise<void> {
    this._ensureWritable('workbook.setCustomLists');
    const { replaceCustomLists } = await import('../../domain/workbook/workbook');
    await replaceCustomLists(
      this.ctx,
      lists.map((list) => ({ name: list.name, values: [...list.values] })),
    );
  }

  // ===========================================================================
  // Custom Settings (arbitrary KV store)
  // ===========================================================================

  async getCustomSetting(key: string): Promise<string | null> {
    return (await this.ctx.computeBridge.getCustomSetting(key)) ?? null;
  }

  async setCustomSetting(key: string, value: string): Promise<void> {
    this._ensureWritable('workbook.setCustomSetting');
    await this.ctx.computeBridge.setCustomSetting(key, value);
  }

  async deleteCustomSetting(key: string): Promise<void> {
    this._ensureWritable('workbook.deleteCustomSetting');
    await this.ctx.computeBridge.setCustomSetting(key, null);
  }

  async listCustomSettings(): Promise<Array<{ key: string; value: string }>> {
    const pairs = await this.ctx.computeBridge.listCustomSettings();
    return pairs.map(([key, value]: [string, string]) => ({ key, value }));
  }

  async getCustomSettingCount(): Promise<number> {
    const settings = await this.listCustomSettings();
    return settings.length;
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async save(path?: string): Promise<Uint8Array> {
    this._ensureNotDisposed();
    const saveTarget = normalizeWorkbookSavePath(path);
    if (saveTarget && !this._writeFile) {
      throw createSaveWriterUnavailableError(saveTarget);
    }

    const buffer = await this.toXlsx();
    if (saveTarget) {
      try {
        await this._writeFile!(saveTarget.requestedPath, buffer);
      } catch (error) {
        throw createSaveWriteFailedError(saveTarget, error);
      }
    }
    if (this._onSave) {
      try {
        await this._onSave(buffer);
      } catch (error) {
        throw createSaveCallbackFailedError(error);
      }
    }
    this.markClean();
    return buffer;
  }

  async close(closeBehavior?: 'save' | 'skipSave'): Promise<void> {
    if (closeBehavior === 'save') {
      await this.save();
    }
    await this.disposeCheckoutMaterializations();
    this.dispose();
  }

  get isDisposed(): boolean {
    return this._disposed || this._liveness.isDisposed;
  }

  get importWarnings(): readonly DocumentImportWarning[] {
    return this._importWarnings;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.dispose();
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._liveness.invalidate({
      operation: 'workbook.dispose',
      message: 'Workbook is closed or disposed. Create a new workbook to continue.',
    });

    // Dispose all tracked child handles (viewport regions, subscriptions, etc.)
    this._disposables.dispose();

    if (this.codeExecutor) {
      this.codeExecutor.dispose();
      this.codeExecutor = null;
    }

    void this.disposeCheckoutMaterializations();

    this._floatingObjectManager.dispose();

    // Dispose all cached WorksheetImpl instances (cleans up CellMetadataCache,
    // ConditionalFormatCache, viewport readers)
    for (const ws of this._worksheetInstances.values()) {
      ws.dispose();
    }
    this._worksheetInstances.clear();

    // Clear checkpoint manager state
    this.checkpointManager.clear();

    // Clear form control manager state if it was lazily created
    if (this._formControlManager) {
      this._formControlManager.clear();
      this._formControlManager = undefined;
    }
  }

  private async disposeCheckoutMaterializations(): Promise<void> {
    const materializations = [...this._checkoutMaterializations];
    this._checkoutMaterializations.clear();
    await Promise.all(
      materializations.map((materialization) =>
        materialization.dispose().catch((err) => {
          slog('workbook.checkoutMaterializationDisposeFailed', { error: err });
        }),
      ),
    );
  }
}
