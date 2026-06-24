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
import { removeMogVersionMetadataPackageInventoryFromXlsx } from './xlsx-clean-export-package';
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
// WorkbookImpl Sub APIs
// =============================================================================

import { WorkbookImplFileLifecycle } from './workbook-impl-file-lifecycle';

export abstract class WorkbookImplSubApis extends WorkbookImplFileLifecycle {
  // ===========================================================================
  // Workbook-Only Context
  // ===========================================================================

  createCalculatorContext(sheetId: SheetId): unknown {
    return { sheetId };
  }

  get ink(): IInkRecognitionBridge | null {
    return this.ctx.inkRecognition ?? null;
  }

  recalculateAll(_sheetId: SheetId, _origin: string = 'user'): void {
    // No-op: all recalculation handled by Rust compute-core
  }

  recalculateSheet(_sheetId: SheetId, _origin: string = 'user'): void {
    // No-op: all recalculation handled by Rust compute-core
  }

  // ===========================================================================
  // Sub-API namespaces (lazy initialization)
  // ===========================================================================

  get sheets(): WorkbookSheets {
    this._ensureNotDisposed();
    return (this._sheets ??= new WorkbookSheetsImpl({
      ctx: this.ctx,
      resolveTarget: (t) => this._resolveTarget(t) as Promise<SheetId>,
      getSheetName: (id) => getName(this.ctx, id),
      getSheetCount: () => this.getSheetCount(),
      setActiveSheetId: (id) => this.stateProvider.setActiveSheetId(id),
      workbook: this as Workbook,
    }));
  }

  get slicers(): WorkbookSlicers {
    return (this._slicers ??= new WorkbookSlicersImpl({
      ctx: this.ctx,
      getWorksheetSlicers: (sheetId) => this._getOrCreateWorksheet(sheetId).slicers,
    }));
  }

  get slicerStyles(): WorkbookSlicerStyles {
    return (this._slicerStyles ??= new WorkbookSlicerStylesImpl({
      ctx: this.ctx,
    }));
  }

  get timelineStyles(): WorkbookTimelineStyles {
    return (this._timelineStyles ??= new WorkbookTimelineStylesImpl({
      ctx: this.ctx,
    }));
  }

  get pivotTableStyles(): WorkbookPivotTableStyles {
    return (this._pivotTableStyles ??= new WorkbookPivotTableStylesImpl(this.ctx));
  }

  get functions(): WorkbookFunctions {
    return (this._functions ??= new WorkbookFunctionsImpl(this.ctx, () => this.getActiveSheetId()));
  }

  get names(): WorkbookNames {
    return (this._names ??= new WorkbookNamesImpl({
      ctx: this.ctx,
      getActiveSheetId: () => this.getActiveSheetId(),
      resolveSheetNameToId: (nameLower) => this._resolveSheetNameToId(nameLower),
      getSheetName: (id) => getName(this.ctx, id),
      getKnownSheetNames: () => getKnownSheetNames(this.ctx),
    }));
  }

  get scenarios(): WorkbookScenarios {
    return (this._scenarios ??= new WorkbookScenariosImpl({
      ctx: this.ctx,
      getActiveSheetId: () => this.getActiveSheetId(),
      getSheetOrder: () => getOrder(this.ctx),
      getSheetName: (id) => getName(this.ctx, id),
      resolveSheetNameToId: (nameLower) => this._resolveSheetNameToId(nameLower),
    }));
  }

  get history(): WorkbookHistory {
    return (this._history ??= new WorkbookHistoryImpl({
      ctx: this.ctx,
      refreshSheetMetadata: () => this.refreshSheetMetadata(),
    }));
  }

  get version(): WorkbookVersion {
    return (this._version ??= new WorkbookVersionWithDirtyTracking(() => this.ctx, {
      checkoutTransactionGuard: this.checkoutTransactions.guard,
      readState: () => this.readVersionDirtyTrackingState(),
      markCleanIfRevisionUnchanged: (revision) => this.markCleanIfDirtyRevisionUnchanged(revision),
    }));
  }

  get tableStyles(): WorkbookTableStyles {
    return (this._tableStyles ??= new WorkbookTableStylesImpl(this.ctx));
  }

  get cellStyles(): WorkbookCellStyles {
    return (this._cellStyles ??= new WorkbookCellStylesImpl(this.ctx));
  }

  get properties(): WorkbookProperties {
    return (this._properties ??= new WorkbookPropertiesImpl(this.ctx));
  }

  get protection(): WorkbookProtection {
    return (this._protection ??= new WorkbookProtectionImpl(this.ctx));
  }

  get security(): WorkbookSecurity {
    this._ensureNotDisposed();
    return (this._security ??= new WorkbookSecurityImpl(this.ctx));
  }

  // Session-level principal API for the
  // "method not sub-API" rationale.

  async setActivePrincipal(principal: string[] | AccessPrincipal | null): Promise<void> {
    // Host-backed workbooks have immutable principals — the principal was
    // projected from the verified host identity at construction time and
    // must not be mutated by ordinary consumers.
    if (this.ctx.operationGate !== NO_HOST_OPERATION_GATE) {
      throw new OperationDeniedError(
        'setActivePrincipal',
        'HOST_PRINCIPAL_IMMUTABLE',
        'setActivePrincipal() is not available on host-backed workbooks. ' +
          'The principal was set during host construction and cannot be changed.',
      );
    }

    const tagsOrNull =
      principal === null ? null : Array.isArray(principal) ? principal : principal.tags;
    await this.ctx.computeBridge.setActivePrincipal(
      tagsOrNull === null ? null : { tags: tagsOrNull },
    );
  }

  async activePrincipal(): Promise<AccessPrincipal | null> {
    return this.ctx.computeBridge.activePrincipal();
  }

  async securityActive(): Promise<boolean> {
    return this.ctx.computeBridge.securityActive();
  }

  async makePrincipal(tags: string[]): Promise<AccessPrincipal> {
    if (this.ctx.operationGate !== NO_HOST_OPERATION_GATE) {
      throw new OperationDeniedError(
        'makePrincipal',
        'HOST_PRINCIPAL_IMMUTABLE',
        'makePrincipal() is not available on host-backed workbooks. ' +
          'Principal management is controlled by the host.',
      );
    }
    return this.ctx.computeBridge.makePrincipal(tags);
  }

  get notifications(): WorkbookNotifications {
    if (!this._notifications) {
      if (!this.ctx.services) {
        throw new KernelError('COMPUTE_ERROR', 'Kernel services not available');
      }
      this._notifications = new WorkbookNotificationsImpl(this.ctx.services.notifications);
    }
    return this._notifications;
  }

  get theme(): WorkbookTheme {
    return (this._theme ??= new WorkbookThemeImpl(
      { ctx: this.ctx, eventBus: this.eventBus },
      DEFAULT_CHROME_THEME,
    ));
  }

  get viewport(): WorkbookViewport {
    return (this._viewport ??= new WorkbookViewportImpl(this.ctx.computeBridge, this._disposables));
  }

  get changes(): WorkbookChanges {
    this._ensureNotDisposed();
    return (this._changes ??= new WorkbookChangesImpl(this.ctx, this._liveness));
  }

  get diagnostics(): WorkbookDiagnostics {
    return (this._diagnostics ??= new WorkbookDiagnosticsImpl(this.ctx, {
      isDirty: () => this.isDirty,
    }));
  }

  get links(): WorkbookLinks {
    return (this._links ??= new WorkbookLinksImpl(this.ctx.workbookLinks, () =>
      this.workbookLinkScope(),
    ));
  }

  private workbookLinkScope(): WorkbookLinkStatusScope {
    return this.ctx.workbookLinkScope();
  }
}
