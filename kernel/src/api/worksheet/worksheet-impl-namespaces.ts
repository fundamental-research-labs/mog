/**
 * WorksheetImpl — Unified Worksheet Implementation
 *
 * THE single implementation of the Worksheet interface. Every consumer —
 * headless agents, LLM code, OS apps, browser app — uses this.
 *
 * @see contracts/src/api/worksheet.ts — Interface definition
 */

import type {
  CellMetadataCache as CellMetadataCacheContract,
  CellRange,
  CFStyle,
  ConditionalFormat,
  ListValidationOptions,
  ListValidationSource,
  ValidationSetReceipt,
  ViewportReader,
  WorksheetAnnotations,
  WorksheetBindings,
  WorksheetChanges,
  WorksheetCharts,
  WorksheetComments,
  WorksheetConditionalFormatting,
  WorksheetConnectorCollection,
  WorksheetCustomProperties,
  WorksheetDiagrams,
  WorksheetDrawingCollection,
  WorksheetEquationCollection,
  WorksheetFilters,
  WorksheetFormControls,
  WorksheetFormats,
  WorksheetHyperlinks,
  WorksheetInternal,
  WorksheetLayout,
  WorksheetNames,
  WorksheetObjectCollection,
  WorksheetOutline,
  WorksheetPictureCollection,
  WorksheetPivots,
  WorksheetPrint,
  WorksheetProtection,
  WorksheetSettings,
  WorksheetShapeCollection,
  WorksheetSlicers,
  WorksheetSparklines,
  WorksheetStyles,
  WorksheetStructure,
  WorksheetTables,
  WorksheetTextBoxCollection,
  WorksheetTextEffectCollection,
  WorksheetValidation,
  WorksheetView,
  WorksheetWhatIf,
} from '@mog-sdk/contracts/api';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  EventByType,
  SpreadsheetEvent,
  SpreadsheetEventType as InternalEventType,
} from '@mog-sdk/contracts/events';
import type { IObjectBoundsReader } from '@mog-sdk/contracts/objects';
import { type CallableDisposable, toDisposable } from '@mog/spreadsheet-utils/disposable';

import { createCellMetadataCache } from '../../bridges/wire/cell-metadata-cache';
import { KernelError } from '../../errors';
import { parseCellRange } from '../internal/utils';
import { WorksheetAnnotationsImpl } from './annotations';
import { WorksheetBindingsImpl } from './bindings';
import { WorksheetChangesImpl } from './changes';
import { WorksheetChartsImpl } from './charts';
import { WorksheetCommentsImpl } from './comments';
import { WorksheetConditionalFormattingImpl } from './conditional-formats';
import {
  WorksheetConnectorCollectionImpl,
  WorksheetDrawingCollectionImpl,
  WorksheetEquationCollectionImpl,
  WorksheetObjectCollectionImpl,
  WorksheetPictureCollectionImpl,
  WorksheetShapeCollectionImpl,
  WorksheetTextBoxCollectionImpl,
  WorksheetTextEffectCollectionImpl,
} from './collections/index';
import { WorksheetCustomPropertiesImpl } from './custom-properties';
import { WorksheetDiagramsImpl } from './diagrams';
import { WorksheetFiltersImpl } from './filters';
import { WorksheetFormControlsImpl } from './form-controls';
import { WorksheetFormatsImpl } from './formats';
import { WorksheetHyperlinksImpl } from './hyperlinks';
import { WorksheetInternalImpl } from './internal';
import { WorksheetLayoutImpl } from './layout';
import { WorksheetNamesImpl } from './names';
import { WorksheetObjectsImpl } from './objects';
import { WorksheetOutlineImpl } from './outline';
import { WorksheetPivotsImpl } from './pivots';
import { WorksheetPrintImpl } from './print';
import { WorksheetProtectionImpl } from './protection';
import { WorksheetSettingsImpl } from './settings';
import { WorksheetSlicersImpl } from './slicers';
import { WorksheetSparklinesImpl } from './sparklines';
import { WorksheetStructureImpl } from './structure';
import { WorksheetStylesImpl } from './styles';
import { WorksheetTablesImpl } from './tables';
import { WorksheetValidationImpl } from './validation';
import { WorksheetViewImpl } from './view';
import { WorksheetWhatIfImpl } from './what-if';
import { SHEET_EVENT_TO_INTERNAL } from './worksheet-events';
import { WorksheetImplBatchApi } from './worksheet-impl-batch-api';
import { toWorksheetRange } from './public-ranges';
import { createViewportReader } from './viewport-reader';

export class WorksheetImplNamespaces extends WorksheetImplBatchApi {
  // ===========================================================================
  // Bounds Reader injection
  // ===========================================================================

  setBoundsReader(reader: IObjectBoundsReader): void {
    this._assertLive('worksheet.setBoundsReader');
    this._boundsReader = reader;
    // Invalidate all cached typed collections so they are recreated with the new reader.
    this._objects = undefined;
    this._objectCollection = undefined;
    this._shapes = undefined;
    this._pictures = undefined;
    this._textBoxes = undefined;
    this._drawings = undefined;
    this._equations = undefined;
    this._textEffects = undefined;
    this._connectors = undefined;
  }

  // ===========================================================================
  // Bridge Sub-Interfaces
  // ===========================================================================

  private _diagrams?: WorksheetDiagramsImpl;

  get diagrams(): WorksheetDiagrams {
    this._assertLive('worksheet.diagrams');
    return (this._diagrams ??= new WorksheetDiagramsImpl(
      this.ctx,
      this.sheetId,
      this._floatingObjectManager,
    ));
  }

  // ===========================================================================
  // Viewport — sync render-path data
  // ===========================================================================

  get viewport(): ViewportReader {
    if (!this._viewport) {
      this._viewport = this._createViewportReader();
    }
    return this._viewport;
  }

  private _createViewportReader(): ViewportReader {
    return createViewportReader(this.sheetId, this.ctx.computeBridge);
  }

  // ===========================================================================
  // Events
  // ===========================================================================

  on<K extends keyof import('@mog-sdk/contracts/api').SheetEventMap>(
    event: K,
    handler: (event: import('@mog-sdk/contracts/api').SheetEventMap[K]) => void,
  ): CallableDisposable;
  on<T extends InternalEventType>(
    event: T,
    handler: (event: EventByType<T>) => void,
  ): CallableDisposable;
  on(event: string, handler: (event: unknown) => void): CallableDisposable;
  on(event: string, handler: (event: any) => void): CallableDisposable {
    // Special case: 'deactivated' is derived from 'sheet:activated' — fires when
    // a DIFFERENT sheet becomes active (meaning this sheet was deactivated).
    if (event === 'deactivated') {
      const unsub = this.ctx.eventBus.on('sheet:activated', (internalEvent: any) => {
        if (internalEvent.sheetId !== this.sheetId) {
          handler({
            type: 'sheet:deactivated',
            sheetId: this.sheetId,
            name: this.name,
            timestamp: Date.now(),
          });
        }
      });
      return toDisposable(unsub);
    }

    const internalTypes = SHEET_EVENT_TO_INTERNAL[event];

    if (internalTypes) {
      // Coarse SheetEvent — subscribe to all mapped internal events, filter by sheetId
      const unsubs: Array<() => void> = [];
      for (const internalType of internalTypes) {
        const unsub = this.ctx.eventBus.on(internalType, (internalEvent: any) => {
          // Sheet-scoped filtering: only fire if the event is for this sheet
          if (internalEvent.sheetId && internalEvent.sheetId !== this.sheetId) return;
          handler(internalEvent); // Pass directly — no wrapper!
        });
        unsubs.push(unsub);
      }
      return toDisposable(() => {
        for (const u of unsubs) u();
      });
    }

    // Warn on unknown event names that aren't fine-grained internal types
    if (
      typeof event === 'string' &&
      !event.includes(':') &&
      event !== 'deactivated' &&
      !(event in SHEET_EVENT_TO_INTERNAL)
    ) {
      console.warn(
        `[Worksheet.on] Unknown event "${event}". ` +
          `Known coarse events: ${Object.keys(SHEET_EVENT_TO_INTERNAL).join(', ')}. ` +
          `For fine-grained events use internal type strings (e.g. "cell:changed").`,
      );
    }

    // Fine-grained InternalEventType passthrough — subscribe directly, filter by sheetId
    const unsub = this.ctx.eventBus.on(event, (internalEvent: any) => {
      if (internalEvent.sheetId && internalEvent.sheetId !== this.sheetId) return;
      handler(internalEvent); // Pass directly — no wrapper!
    });
    return toDisposable(unsub);
  }

  emit(event: SpreadsheetEvent): void {
    this.ctx.eventBus.emit(event);
  }

  /**
   * Subscribe to multiple events at once. Returns a single unsubscribe function.
   *
   * Accepts either `SheetEventMap` keys (camelCase, public API) or
   * `InternalEventType` strings (colon-separated, fine-grained). These are the
   * same two name spaces the single-event `on()` overloads accept; this method
   * just dispatches one subscription per element so each call binds to the
   * right typed overload. The untyped `on(string, (unknown) => void)` overload
   * is NOT used — callers always get payload typing through the underlying
   * `on()` generics.
   *
   * The handler receives the widened union of every payload the subscribed
   * events could emit: `SpreadsheetEvent` (all `InternalEventType` payloads)
   * plus `SheetEventMap[keyof SheetEventMap]` (which adds the synthetic
   * `sheet:deactivated` event that exists only on the public API surface).
   */
  onMany(
    events: Array<keyof import('@mog-sdk/contracts/api').SheetEventMap | InternalEventType>,
    handler: (
      event:
        | SpreadsheetEvent
        | import('@mog-sdk/contracts/api').SheetEventMap[keyof import('@mog-sdk/contracts/api').SheetEventMap],
    ) => void,
  ): () => void {
    const unsubs: CallableDisposable[] = [];
    for (const e of events) {
      // Colon-separated = InternalEventType overload; otherwise = SheetEventMap
      // overload. The runtime split matches the contract boundary declared in
      // `SHEET_EVENT_TO_INTERNAL` (contracts/src/api/internal-events).
      if (e.includes(':')) {
        unsubs.push(this.on(e as InternalEventType, handler));
      } else {
        const key = e as keyof import('@mog-sdk/contracts/api').SheetEventMap;
        unsubs.push(this.on(key, handler));
      }
    }
    return () => {
      for (const u of unsubs) u();
    };
  }

  // ===========================================================================
  // Reactive Caches
  // ===========================================================================

  get cellMetadata(): CellMetadataCacheContract {
    this._assertLive('worksheet.cellMetadata');
    if (!this._cellMetadata) {
      const cache = createCellMetadataCache(this.workbook);
      this._rawCellMetadataCache = cache;
      // Auto-register with MutationResultHandler for post-recalc patching
      this.ctx.computeBridge.setCellMetadataCache(cache);
      this._cellMetadata = {
        isProjectedPosition: (row, col) => cache.isProjectedPosition(row, col),
        getProjectionSourcePosition: (row, col) => cache.getProjectionSourcePosition(row, col),
        getProjectionRange: (row, col) => {
          const range = cache.getProjectionRange(row, col);
          return range ? toWorksheetRange(range) : undefined;
        },
        hasValidationErrors: (row, col) => cache.hasValidationErrors(row, col),
        evaluateViewport: (sheetId, startRow, startCol, endRow, endCol) =>
          cache.evaluateViewport(toSheetId(sheetId), startRow, startCol, endRow, endCol),
        onChange: (callback) => cache.onChange(callback),
        clear: () => cache.clear(),
        destroy: () => cache.dispose(),
      };
    }
    return this._cellMetadata;
  }

  async setListValidation(
    range: string | CellRange,
    source: ListValidationSource,
    options?: ListValidationOptions,
  ): Promise<ValidationSetReceipt> {
    return typeof range === 'string'
      ? this.validations.setList(range, source, options)
      : this.validations.setList(range, source, options);
  }

  async setFormulaConditionalFormat(
    range: string | CellRange | (string | CellRange)[],
    formula: string,
    style: CFStyle,
  ): Promise<ConditionalFormat> {
    return this.conditionalFormats.addFormula(range, formula, style);
  }

  // ===========================================================================
  // Sub-API namespaces (lazy initialization)
  // ===========================================================================

  private _changes?: WorksheetChangesImpl;
  get changes(): WorksheetChanges {
    this._assertLive('worksheet.changes');
    return (this._changes ??= new WorksheetChangesImpl(this.ctx, this.sheetId, this._liveness));
  }

  private _formats?: WorksheetFormatsImpl;
  get formats(): WorksheetFormats {
    return (this._formats ??= new WorksheetFormatsImpl(this.ctx, this.sheetId));
  }

  private _layout?: WorksheetLayoutImpl;
  get layout(): WorksheetLayout {
    return (this._layout ??= new WorksheetLayoutImpl(this.ctx, this.sheetId));
  }

  private _view?: WorksheetViewImpl;
  get view(): WorksheetView {
    return (this._view ??= new WorksheetViewImpl(this.ctx, this.sheetId));
  }

  private _structure?: WorksheetStructureImpl;
  get structure(): WorksheetStructure {
    return (this._structure ??= new WorksheetStructureImpl(this.ctx, this.sheetId));
  }

  private _charts?: WorksheetChartsImpl;
  get charts(): WorksheetCharts {
    return (this._charts ??= new WorksheetChartsImpl(
      this.ctx,
      this.sheetId,
      this.ctx.chartImageExporter,
    ));
  }

  private _objects?: WorksheetObjectsImpl;
  private _objectCollection?: WorksheetObjectCollectionImpl;
  get objects(): WorksheetObjectCollection {
    return (this._objectCollection ??= new WorksheetObjectCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  /** Internal accessor — ensures _objects is initialized and returns the concrete type. */
  private get _objectsImpl(): WorksheetObjectsImpl {
    return (this._objects ??= new WorksheetObjectsImpl(
      this.ctx,
      this.sheetId,
      this._floatingObjectManager,
    ));
  }

  // ── Typed floating object collections ─────────────────────

  private _shapes?: WorksheetShapeCollectionImpl;
  get shapes(): WorksheetShapeCollection {
    return (this._shapes ??= new WorksheetShapeCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _pictures?: WorksheetPictureCollectionImpl;
  get pictures(): WorksheetPictureCollection {
    return (this._pictures ??= new WorksheetPictureCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _textBoxes?: WorksheetTextBoxCollectionImpl;
  get textBoxes(): WorksheetTextBoxCollection {
    return (this._textBoxes ??= new WorksheetTextBoxCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _drawings?: WorksheetDrawingCollectionImpl;
  get drawings(): WorksheetDrawingCollection {
    return (this._drawings ??= new WorksheetDrawingCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _equations?: WorksheetEquationCollectionImpl;
  get equations(): WorksheetEquationCollection {
    return (this._equations ??= new WorksheetEquationCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _textEffects?: WorksheetTextEffectCollectionImpl;
  get textEffects(): WorksheetTextEffectCollection {
    return (this._textEffects ??= new WorksheetTextEffectCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _connectors?: WorksheetConnectorCollectionImpl;
  get connectors(): WorksheetConnectorCollection {
    return (this._connectors ??= new WorksheetConnectorCollectionImpl(
      this._objectsImpl,
      this._boundsReader,
    ));
  }

  private _filters?: WorksheetFiltersImpl;
  get filters(): WorksheetFilters {
    return (this._filters ??= new WorksheetFiltersImpl(this.ctx, this.sheetId));
  }

  private _formControls?: WorksheetFormControlsImpl;
  get formControls(): WorksheetFormControls {
    return (this._formControls ??= new WorksheetFormControlsImpl(
      this.ctx,
      (
        this.workbook as unknown as {
          getFormControlManager(): import('@mog-sdk/contracts/form-controls').IFormControlManager;
        }
      ).getFormControlManager(),
      this.sheetId,
    ));
  }

  private _conditionalFormatsAPI?: WorksheetConditionalFormattingImpl;
  get conditionalFormats(): WorksheetConditionalFormatting {
    return (this._conditionalFormatsAPI ??= new WorksheetConditionalFormattingImpl(
      this.ctx,
      this.sheetId,
    ));
  }

  private _validation?: WorksheetValidationImpl;

  get validations(): WorksheetValidation {
    this._assertLive('worksheet.validations');
    return (this._validation ??= new WorksheetValidationImpl(
      this.ctx,
      this.sheetId,
      this._liveness,
    ));
  }

  private _tables?: WorksheetTablesImpl;
  get tables(): WorksheetTables {
    return (this._tables ??= new WorksheetTablesImpl(this.ctx, this.sheetId));
  }

  private _pivots?: WorksheetPivotsImpl;
  get pivots(): WorksheetPivots {
    this._assertLive('worksheet.pivots');
    return (this._pivots ??= new WorksheetPivotsImpl(
      this.ctx,
      this.sheetId,
      this.workbook,
      this._liveness,
    ));
  }

  private _slicers?: WorksheetSlicersImpl;
  get slicers(): WorksheetSlicers {
    return (this._slicers ??= new WorksheetSlicersImpl(this.ctx, this.sheetId));
  }

  private _sparklines?: WorksheetSparklinesImpl;
  get sparklines(): WorksheetSparklines {
    return (this._sparklines ??= new WorksheetSparklinesImpl(this.ctx, this.sheetId));
  }

  private _annotations?: WorksheetAnnotationsImpl;
  get annotations(): WorksheetAnnotations {
    return (this._annotations ??= new WorksheetAnnotationsImpl(this.ctx, this.sheetId));
  }

  private _comments?: WorksheetCommentsImpl;
  get comments(): WorksheetComments {
    return (this._comments ??= new WorksheetCommentsImpl(this.ctx, this.sheetId));
  }

  private _customProperties?: WorksheetCustomPropertiesImpl;
  get customProperties(): WorksheetCustomProperties {
    return (this._customProperties ??= new WorksheetCustomPropertiesImpl(this.ctx, this.sheetId));
  }

  private _hyperlinks?: WorksheetHyperlinksImpl;
  get hyperlinks(): WorksheetHyperlinks {
    return (this._hyperlinks ??= new WorksheetHyperlinksImpl(this.ctx, this.sheetId));
  }

  private _outline?: WorksheetOutlineImpl;
  get outline(): WorksheetOutline {
    return (this._outline ??= new WorksheetOutlineImpl(this.ctx, this.sheetId));
  }

  private _protection?: WorksheetProtectionImpl;
  get protection(): WorksheetProtection {
    return (this._protection ??= new WorksheetProtectionImpl(this.ctx, this.sheetId));
  }

  private _whatIf?: WorksheetWhatIfImpl;
  get whatIf(): WorksheetWhatIf {
    return (this._whatIf ??= new WorksheetWhatIfImpl(this.ctx, this.sheetId));
  }

  private _print?: WorksheetPrintImpl;
  get print(): WorksheetPrint {
    return (this._print ??= new WorksheetPrintImpl(this.ctx, this.sheetId));
  }

  private _settings?: WorksheetSettingsImpl;
  get settings(): WorksheetSettings {
    return (this._settings ??= new WorksheetSettingsImpl(this.ctx, this.sheetId));
  }

  private _bindings?: WorksheetBindingsImpl;
  get bindings(): WorksheetBindings {
    return (this._bindings ??= new WorksheetBindingsImpl(this.ctx, this.sheetId));
  }

  private _names?: WorksheetNamesImpl;
  get names(): WorksheetNames {
    return (this._names ??= new WorksheetNamesImpl(this.ctx, this.sheetId));
  }

  private _styles?: WorksheetStylesImpl;
  get styles(): WorksheetStyles {
    return (this._styles ??= new WorksheetStylesImpl(this.ctx, this.sheetId));
  }

  private __internal?: WorksheetInternalImpl;
  get _internal(): WorksheetInternal {
    return (this.__internal ??= new WorksheetInternalImpl(this.ctx, this.sheetId));
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._activeCellEditSourceCache.dispose();
    // Dispose the _internal sub-API's cfCache if it was created
    if (this.__internal) {
      (this.__internal as WorksheetInternalImpl).dispose();
      this.__internal = undefined;
    }
    if (this._cellMetadata) {
      this._cellMetadata.destroy();
      this._cellMetadata = null;
      this._rawCellMetadataCache = null;
      // Auto-unregister from MutationResultHandler
      this.ctx.computeBridge.setCellMetadataCache(null);
    }
    this._viewport = null;
  }
}
