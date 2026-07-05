/**
 * WorksheetImpl — Unified Worksheet Implementation
 *
 * THE single implementation of the Worksheet interface. Every consumer —
 * headless agents, LLM code, OS apps, browser app — uses this.
 *
 * @see contracts/src/api/worksheet.ts — Interface definition
 */

import type {
  CellAnnotationWriteOptions,
  CellRange,
  CellWriteOptions,
  ClearApplyTo,
  ClearResult,
  WorksheetRangeFormulaInput,
  WorksheetRangeValueInput,
} from '@mog-sdk/contracts/api';
import type { CellValuePrimitive } from '@mog-sdk/contracts/core';

import { KernelError } from '../../errors';
import { resolveCell, resolveRange } from '../internal/address-resolver';
import { parseCellAddress, parseCellRange } from '../internal/utils';
import {
  createVersionMutationAdmissionOptions,
  createVersionOperationContext,
} from '../workbook/version-operation-context';
import { deletePivotsContainedByClearRange } from './pivot-clear';
import { formControlLinkedCellResetValue } from './form-control-linked-cell-reset';
import {
  assertNoAmbiguousFormulaText,
  isExplicitTextWrite,
  normalizeFormulaA1,
  type ExplicitTextWriteOptions,
} from './formula-api-helpers';
import {
  annotationFromOptions,
  normalizeRangeFormulaValues,
  normalizeRangeWriteValues,
} from './annotation-write-options';
import * as CellOps from './operations/cell-operations';
import * as RangeOps from './operations/range-operations';
import * as RangeQueryOps from './operations/range-query-operations';
import { resolveDateWriteArgs, resolveTimeWriteArgs } from './worksheet-date-time-args';
import { resolveMatrixWriteArgs } from './worksheet-write-args';
import { WorksheetImplBase } from './worksheet-impl-base';

export abstract class WorksheetImplCellWriteApi extends WorksheetImplBase {
  async setCell(
    address: string,
    value: CellValuePrimitive | Date,
    options?: CellWriteOptions,
  ): Promise<void>;
  async setCell(
    row: number,
    col: number,
    value: CellValuePrimitive | Date,
    options?: CellWriteOptions,
  ): Promise<void>;
  async setCell(a: string | number, b: any, c?: any, d?: any): Promise<void> {
    this._assertLive('worksheet.setCell');
    this._ensureWritable('worksheet.setCell');
    let { row, col, value, options } = this.resolveCellWriteArgs(a, b, c, d);
    const annotation = annotationFromOptions('worksheet.setCell', options);
    if (options?.asFormula === true && isExplicitTextWrite(options)) {
      throw new KernelError(
        'API_INVALID_ARGUMENT',
        'worksheet.setCell: options.asFormula cannot be combined with options.asText/literal.',
      );
    }
    assertNoAmbiguousFormulaText('worksheet.setCell', value, options, 'missingEqualsOnly');

    await this.ensureCellEditable(row, col);

    // Date values delegate to setDateValue
    if (value instanceof Date) {
      await this.setDateValue(row, col, value);
      await this.applyCellAnnotation(row, col, annotation);
      return;
    }

    // Prefix explicit text writes with Excel's literal marker so parsing never
    // coerces numeric-looking IDs, dates, or formula-shaped strings.
    if (isExplicitTextWrite(options) && typeof value === 'string') {
      value = "'" + value;
    }

    // If asFormula option is set, prepend = if not already
    if (options?.asFormula && typeof value === 'string' && !value.startsWith('=')) {
      value = normalizeFormulaA1(value, 'worksheet.setCell');
    }

    this._invalidateActiveCellEditSourceForCell(row, col);
    await CellOps.setCell(
      this.ctx,
      this.sheetId,
      row,
      col,
      value as CellValuePrimitive,
      createVersionMutationAdmissionOptions(this.ctx, {
        operationIdPrefix: 'worksheet.setCell',
        sheetIds: [this.sheetId],
        domainIds: ['cells'],
      }),
    );
    await this.applyCellAnnotation(row, col, annotation);
  }

  async setValue(
    address: string,
    value: CellValuePrimitive | Date,
    options?: ExplicitTextWriteOptions,
  ): Promise<void>;
  async setValue(
    row: number,
    col: number,
    value: CellValuePrimitive | Date,
    options?: ExplicitTextWriteOptions,
  ): Promise<void>;
  async setValue(a: string | number, b: any, c?: any, d?: any): Promise<void> {
    this._assertLive('worksheet.setValue');
    this._ensureWritable('worksheet.setValue');
    let { row, col, value, options } = this.resolveCellWriteArgs(a, b, c, d);
    const annotation = annotationFromOptions('worksheet.setValue', options);
    assertNoAmbiguousFormulaText('worksheet.setValue', value, options, 'formulaOrMissingEquals');

    await this.ensureCellEditable(row, col);

    if (value instanceof Date) {
      await this.setDateValue(row, col, value);
      await this.applyCellAnnotation(row, col, annotation);
      return;
    }

    if (isExplicitTextWrite(options) && typeof value === 'string') {
      value = "'" + value;
    }

    this._invalidateActiveCellEditSourceForCell(row, col);
    await CellOps.setCell(this.ctx, this.sheetId, row, col, value as CellValuePrimitive, {
      operationContext: createVersionOperationContext(this.ctx, {
        operationIdPrefix: 'worksheet.setValue',
        sheetIds: [this.sheetId],
        domainIds: ['cells'],
      }),
    });
    await this.applyCellAnnotation(row, col, annotation);
  }

  async setFormula(
    address: string,
    formula: string,
    options?: CellAnnotationWriteOptions,
  ): Promise<void>;
  async setFormula(
    row: number,
    col: number,
    formula: string,
    options?: CellAnnotationWriteOptions,
  ): Promise<void>;
  async setFormula(
    a: string | number,
    b: number | string,
    c?: string | CellAnnotationWriteOptions,
    d?: CellAnnotationWriteOptions,
  ): Promise<void> {
    this._assertLive('worksheet.setFormula');
    this._ensureWritable('worksheet.setFormula');
    const { row, col, value, options } = this.resolveCellWriteArgs(a, b, c, d);
    const annotation = annotationFromOptions('worksheet.setFormula', options);
    const formula = normalizeFormulaA1(value as string, 'worksheet.setFormula');

    await this.ensureCellEditable(row, col);
    this._invalidateActiveCellEditSourceForCell(row, col);
    await CellOps.setCell(this.ctx, this.sheetId, row, col, formula, {
      operationContext: createVersionOperationContext(this.ctx, {
        operationIdPrefix: 'worksheet.setFormula',
        sheetIds: [this.sheetId],
        domainIds: ['cells'],
      }),
    });
    await this.applyCellAnnotation(row, col, annotation);
  }

  async setFormulas(range: string, formulas: WorksheetRangeFormulaInput[][]): Promise<void>;
  async setFormulas(range: CellRange, formulas: WorksheetRangeFormulaInput[][]): Promise<void>;
  async setFormulas(
    startRow: number,
    startCol: number,
    formulas: WorksheetRangeFormulaInput[][],
  ): Promise<void>;
  async setFormulas(
    a: string | number | CellRange,
    b: any,
    c?: WorksheetRangeFormulaInput[][],
  ): Promise<void> {
    this._assertLive('worksheet.setFormulas');
    this._ensureWritable('worksheet.setFormulas');
    const { startRow, startCol, values: formulas } = resolveMatrixWriteArgs<unknown>(a, b, c);

    const { values, annotationTargets } = normalizeRangeFormulaValues(
      'worksheet.setFormulas',
      startRow,
      startCol,
      formulas,
    );

    if (!values.length || !values[0]?.length) {
      return;
    }

    await this.ensureRangeEditable(
      startRow,
      startCol,
      startRow + values.length - 1,
      startCol + (values[0]?.length ?? 1) - 1,
    );

    this._invalidateActiveCellEditSourceForRange({
      startRow,
      startCol,
      endRow: startRow + values.length - 1,
      endCol: startCol + (values[0]?.length ?? 1) - 1,
    });
    await RangeOps.setRange(this.ctx, this.sheetId, startRow, startCol, values, {
      operationContext: createVersionOperationContext(this.ctx, {
        operationIdPrefix: 'worksheet.setFormulas',
        sheetIds: [this.sheetId],
        domainIds: ['cells'],
      }),
    });
    await this.applyCellAnnotations(annotationTargets);
  }

  setDateValue(row: number, col: number, year: number, month: number, day: number): Promise<void>;
  setDateValue(addr: string, year: number, month: number, day: number): Promise<void>;
  setDateValue(row: number, col: number, isoDate: string): Promise<void>;
  setDateValue(addr: string, isoDate: string): Promise<void>;
  setDateValue(row: number, col: number, date: Date, opts?: { tz?: string }): Promise<void>;
  setDateValue(addr: string, date: Date, opts?: { tz?: string }): Promise<void>;
  async setDateValue(
    a: string | number,
    b: string | number | Date,
    c?: number | Date | string | { tz?: string },
    d?: number | { tz?: string },
    e?: number,
  ): Promise<void> {
    this._assertLive('worksheet.setDateValue');
    this._ensureWritable('worksheet.setDateValue');
    const { row, col, year, month, day } = resolveDateWriteArgs(
      this.ctx.userTimezone,
      a,
      b,
      c,
      d,
      e,
    );
    await this.ensureCellEditable(row, col);
    this._invalidateActiveCellEditSourceForCell(row, col);
    await CellOps.setDateValue(
      this.ctx,
      this.sheetId,
      row,
      col,
      { year, month, day },
      {
        operationContext: createVersionOperationContext(this.ctx, {
          operationIdPrefix: 'worksheet.setDateValue',
          sheetIds: [this.sheetId],
          domainIds: ['cells'],
        }),
      },
    );
  }

  setTimeValue(
    row: number,
    col: number,
    hours: number,
    minutes: number,
    seconds: number,
  ): Promise<void>;
  setTimeValue(addr: string, hours: number, minutes: number, seconds: number): Promise<void>;
  setTimeValue(row: number, col: number, date: Date, opts?: { tz?: string }): Promise<void>;
  setTimeValue(addr: string, date: Date, opts?: { tz?: string }): Promise<void>;
  async setTimeValue(
    a: string | number,
    b: number | Date,
    c?: number | Date | { tz?: string },
    d?: number | { tz?: string },
    e?: number,
  ): Promise<void> {
    this._assertLive('worksheet.setTimeValue');
    this._ensureWritable('worksheet.setTimeValue');
    const { row, col, hours, minutes, seconds } = resolveTimeWriteArgs(
      this.ctx.userTimezone,
      a,
      b,
      c,
      d,
      e,
    );
    await this.ensureCellEditable(row, col);
    this._invalidateActiveCellEditSourceForCell(row, col);
    await CellOps.setTimeValue(
      this.ctx,
      this.sheetId,
      row,
      col,
      { hours, minutes, seconds },
      {
        operationContext: createVersionOperationContext(this.ctx, {
          operationIdPrefix: 'worksheet.setTimeValue',
          sheetIds: [this.sheetId],
          domainIds: ['cells'],
        }),
      },
    );
  }

  async setRange(range: string, values: WorksheetRangeValueInput[][]): Promise<void>;
  async setRange(range: CellRange, values: WorksheetRangeValueInput[][]): Promise<void>;
  async setRange(
    startRow: number,
    startCol: number,
    values: WorksheetRangeValueInput[][],
  ): Promise<void>;
  async setRange(
    a: string | number | CellRange,
    b: any,
    c?: WorksheetRangeValueInput[][],
  ): Promise<void> {
    this._assertLive('worksheet.setRange');
    this._ensureWritable('worksheet.setRange');
    const {
      startRow,
      startCol,
      values: inputValues,
    } = resolveMatrixWriteArgs<WorksheetRangeValueInput[][]>(a, b, c);
    const { values, annotationTargets } = normalizeRangeWriteValues(
      'worksheet.setRange',
      startRow,
      startCol,
      inputValues,
    );

    await this.ensureRangeEditable(
      startRow,
      startCol,
      startRow + values.length - 1,
      startCol + (values[0]?.length ?? 1) - 1,
    );

    this._invalidateActiveCellEditSourceForRange({
      startRow,
      startCol,
      endRow: startRow + values.length - 1,
      endCol: startCol + (values[0]?.length ?? 1) - 1,
    });
    await RangeOps.setRange(
      this.ctx,
      this.sheetId,
      startRow,
      startCol,
      values,
      createVersionMutationAdmissionOptions(this.ctx, {
        operationIdPrefix: 'worksheet.setRange',
        sheetIds: [this.sheetId],
        domainIds: ['cells'],
      }),
    );
    await this.applyCellAnnotations(annotationTargets);
  }

  /**
   * Enter a CSE array formula on the given range. Routes directly to
   * Rust `compute-core::set_array_formula` — the engine marks the
   * anchor (`mirror.cse_anchors`) and registers the projection so
   * subsequent partial writes are rejected as
   * `ComputeError::PartialArrayWrite`.
   */
  async setArrayFormula(range: CellRange, formula: string): Promise<void> {
    this._ensureWritable('worksheet.setArrayFormula');
    await this.ensureRangeEditable(range.startRow, range.startCol, range.endRow, range.endCol);
    this._invalidateActiveCellEditSourceForRange(range);
    await this.ctx.computeBridge.setArrayFormula(
      this.sheetId,
      range.startRow,
      range.startCol,
      range.endRow,
      range.endCol,
      formula,
    );
    // Stream B fix: force a full viewport re-render for all viewports on this
    // sheet. The incremental patches path (enrich_metadata_flags) uses the
    // CellId-keyed lookup and misses projection members, so D2/D3 come back
    // with HAS_FORMULA=false after the mutation patch. The full render path
    // (build_viewport_render_data_inner → cell_render_at) correctly sets
    // HAS_FORMULA for all projection members. Refreshing here ensures the
    // viewport buffer reflects projection membership immediately.
    //
    // We must invalidate the prefetch cache first so the refresh is not
    // skipped by the "within existing prefetch bounds" guard (which would
    // otherwise return immediately, keeping the stale post-patch buffer).
    const vpStates = this.ctx.computeBridge.getPerViewportStates();
    const suffix = ':' + this.sheetId;
    const boundsToRefresh: Array<{
      vpId: string;
      bounds: { startRow: number; startCol: number; endRow: number; endCol: number };
    }> = [];
    for (const [vpId, state] of vpStates) {
      if (vpId.endsWith(suffix) && state.prefetchBounds) {
        boundsToRefresh.push({ vpId, bounds: state.prefetchBounds });
      }
    }
    if (boundsToRefresh.length > 0) {
      // Invalidate all prefetch so the next refresh call does not skip.
      this.ctx.computeBridge.invalidateAllViewportPrefetch();
      await Promise.all(
        boundsToRefresh.map(({ vpId, bounds }) =>
          this.ctx.computeBridge.refreshViewportForRegion(vpId, this.sheetId, bounds),
        ),
      );
    }

    // Stream C fix: refresh the active-cell metadata cache so the formula bar
    // immediately sees isCseAnchor=true and renders `{=…}` braces. The anchor
    // cell is always at the top-left of the range. We must look up its cellId
    // after the write because the engine creates it during set_array_formula.
    const anchorCellId = await this.ctx.computeBridge.getCellIdAt(
      this.sheetId,
      range.startRow,
      range.startCol,
    );
    if (anchorCellId) {
      await this.ctx.computeBridge.refreshActiveCell(this.sheetId, anchorCellId);
    }
  }

  /**
   * Refresh the active-cell metadata cache for the given cell position.
   * Looks up the cellId and calls computeBridge.refreshActiveCell so that
   * the formula bar reads fresh `isCseAnchor` / `isArrayFormula` metadata.
   */
  async refreshActiveCellData(row: number, col: number): Promise<void> {
    const inFlight = this._activeCellDataRefreshInFlight;
    if (inFlight && inFlight.row === row && inFlight.col === col) {
      return inFlight.promise;
    }

    const promise = (async () => {
      const cellId = await this.ctx.computeBridge.getCellIdAt(this.sheetId, row, col);
      if (cellId) {
        await this.ctx.computeBridge.refreshActiveCell(this.sheetId, cellId);
      }
    })();

    this._activeCellDataRefreshInFlight = { row, col, promise };
    try {
      await promise;
    } finally {
      if (this._activeCellDataRefreshInFlight?.promise === promise) {
        this._activeCellDataRefreshInFlight = null;
      }
    }
  }

  /** @deprecated Use clear(range, 'contents') instead */
  async clearData(
    a: string | number | CellRange,
    b?: number,
    c?: number,
    d?: number,
  ): Promise<ClearResult> {
    this._ensureWritable('worksheet.clearData');
    const bounds = resolveRange(a, b, c, d);
    await this.ensureRangeEditable(bounds.startRow, bounds.startCol, bounds.endRow, bounds.endCol);
    this._invalidateActiveCellEditSourceForRange(bounds);
    return RangeOps.clearRange(
      this.ctx,
      this.sheetId,
      {
        sheetId: this.sheetId,
        startRow: bounds.startRow,
        startCol: bounds.startCol,
        endRow: bounds.endRow,
        endCol: bounds.endCol,
      },
      {
        operationContext: createVersionOperationContext(this.ctx, {
          operationIdPrefix: 'worksheet.clearData',
          sheetIds: [this.sheetId],
          domainIds: ['cells'],
        }),
      },
    );
  }

  async clear(range: string | CellRange, applyTo?: ClearApplyTo): Promise<ClearResult> {
    this._ensureWritable('worksheet.clear');
    const bounds =
      typeof range === 'object'
        ? range
        : (() => {
            const parsed = parseCellRange(range);
            if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${range}"`);
            return parsed;
          })();
    const clearMode = RangeQueryOps.validateClearApplyTo(applyTo ?? 'all');
    await this.ensureRangeEditable(bounds.startRow, bounds.startCol, bounds.endRow, bounds.endCol);
    await deletePivotsContainedByClearRange(this.ctx, this.sheetId, bounds, clearMode);
    this._invalidateActiveCellEditSourceForRange(bounds);
    return RangeQueryOps.clearWithMode(
      this.ctx,
      this.sheetId,
      { sheetId: this.sheetId, ...bounds },
      clearMode,
      {
        operationContext: createVersionOperationContext(this.ctx, {
          operationIdPrefix: 'worksheet.clear',
          sheetIds: [this.sheetId],
          domainIds: ['cells'],
        }),
      },
    );
  }

  async clearOrResetContents(range: string): Promise<void> {
    this._ensureWritable('worksheet.clearOrResetContents');
    const parsed = parseCellRange(range);
    if (!parsed) throw new KernelError('COMPUTE_ERROR', `Invalid range: "${range}"`);

    const { startRow, startCol, endRow, endCol } = parsed;

    // Identify form-control-linked cells within the range
    const linkedCells: Array<{
      row: number;
      col: number;
      resetValue?: CellValuePrimitive;
    }> = [];

    const controls = this.formControls.list();
    if (controls.length > 0) {
      // Resolve each control's linkedCellId to a position
      const controlsWithLinkedCell = controls.filter(
        (c): c is typeof c & { linkedCellId: string } => {
          return 'linkedCellId' in c && !!(c as { linkedCellId?: string }).linkedCellId;
        },
      );
      const resolutions = await Promise.all(
        controlsWithLinkedCell.map(async (control) => {
          const pos = await this.ctx.computeBridge.getCellPosition(
            this.sheetId,
            control.linkedCellId,
          );
          return { control, pos };
        }),
      );

      for (const { control, pos } of resolutions) {
        if (
          pos &&
          pos.row >= startRow &&
          pos.row <= endRow &&
          pos.col >= startCol &&
          pos.col <= endCol
        ) {
          linkedCells.push({
            row: pos.row,
            col: pos.col,
            resetValue: formControlLinkedCellResetValue(control),
          });
        }
      }
    }

    // Clear all contents in the range
    await this.clear(range, 'contents');

    // Reset linked cells to their default values
    for (const { row, col, resetValue } of linkedCells) {
      if (resetValue !== undefined) {
        await CellOps.setCell(this.ctx, this.sheetId, row, col, resetValue);
      }
      // Buttons have no value to reset.
    }
  }

  // ===========================================================================
  // Cell controls (checkbox)
  // ===========================================================================

  async getControl(
    a: string | number,
    b?: number,
  ): Promise<import('@mog-sdk/contracts/core').CellControl | undefined> {
    const { row, col } = resolveCell(a, b);
    return CellOps.getControl(this.ctx, this.sheetId, row, col);
  }

  async setControl(
    a: string | number,
    b: number | import('@mog-sdk/contracts/core').CellControl | undefined,
    c?: import('@mog-sdk/contracts/core').CellControl | undefined,
  ): Promise<void> {
    this._ensureWritable('worksheet.setControl');
    if (typeof a === 'string') {
      // setControl(address, control)
      const { row, col } = resolveCell(a);
      const control = b as import('@mog-sdk/contracts/core').CellControl | undefined;
      await this.ensureCellEditable(row, col);
      this._invalidateActiveCellEditSourceForCell(row, col);
      await CellOps.setControl(this.ctx, this.sheetId, row, col, control);
    } else {
      // setControl(row, col, control)
      const row = a;
      const col = b as number;
      const control = c;
      await this.ensureCellEditable(row, col);
      this._invalidateActiveCellEditSourceForCell(row, col);
      await CellOps.setControl(this.ctx, this.sheetId, row, col, control);
    }
  }
}
