/**
 * WorksheetValidationImpl — Implementation of the WorksheetValidation sub-API.
 *
 * Delegates to validation-operations.ts for range schema management.
 * Translates between the public ValidationRule type and internal RangeSchema.
 */
import type {
  CellRange,
  DropdownItemsWithRevision,
  SheetId,
  ValidationCheckResult,
  ValidationRule,
  ValidationSetReceipt,
  WorksheetValidation,
} from '@mog-sdk/contracts/api';

import type { RangeSchemaCreatedEvent, RangeSchemaDeletedEvent } from '@mog-sdk/contracts/events';

import type { RangeSchema } from '../../bridges/compute/compute-bridge';
import type { DocumentContext } from '../../context';
import * as Properties from '../../domain/cells/cell-properties';
import { resolveCell, resolveRange } from '../internal/address-resolver';
import { parseCellRange } from '../internal/utils';
import {
  applyListSourceString,
  errorStyleToEnforcement,
  rangeSchemaToValidationRule,
  validationRuleToConstraints,
  validationTypeToSchemaType,
} from './operations/validation-helpers';
import { getDropdownItems, resolveDropdownItems } from './operations/validation-operations';
import { getWorksheetValidationCache } from './validation-cache';

function enforcementToValidationErrorStyle(
  enforcement?: RangeSchema['enforcement'],
): ValidationCheckResult['errorStyle'] {
  switch (enforcement) {
    case 'strict':
      return 'stop';
    case 'warning':
      return 'warning';
    case 'info':
      return 'information';
    case 'none':
      return 'none';
    default:
      return 'stop';
  }
}

function isListValidationSchema(schema: RangeSchema): boolean {
  const constraints = schema.schema.constraints;
  return (
    (schema.schema.type as string | undefined) === 'list' ||
    constraints?.enum != null ||
    constraints?.enumSource != null ||
    constraints?.enumSourceFormula != null
  );
}

export class WorksheetValidationImpl implements WorksheetValidation {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
  ) {}

  private _ensureWritable(op: string): void {
    this.ctx.writeGate.assertWritable(op);
  }

  async set(
    a: string | number | CellRange,
    b: ValidationRule | number,
    c?: ValidationRule,
  ): Promise<ValidationSetReceipt> {
    this._ensureWritable('validation.set');
    let startRow: number, startCol: number, endRow: number, endCol: number;
    let rule: ValidationRule;

    if (typeof a === 'object') {
      // CellRange form: set(range, rule)
      startRow = a.startRow;
      startCol = a.startCol;
      endRow = a.endRow;
      endCol = a.endCol;
      rule = b as ValidationRule;
    } else if (typeof a === 'string') {
      rule = b as ValidationRule;
      const rangeResult = parseCellRange(a);
      if (rangeResult) {
        startRow = rangeResult.startRow;
        startCol = rangeResult.startCol;
        endRow = rangeResult.endRow;
        endCol = rangeResult.endCol;
      } else {
        const pos = resolveCell(a);
        startRow = pos.row;
        startCol = pos.col;
        endRow = pos.row;
        endCol = pos.col;
      }
    } else {
      startRow = a;
      startCol = b as number;
      endRow = a;
      endCol = b as number;
      rule = c!;
    }

    const constraints = validationRuleToConstraints(rule);

    // Handle listSource — Excel's list validation source string. Supports three forms:
    //   "=A1:A5" / "=$A$1:$A$5"  (range reference, leading `=` optional)
    //   "=Colors"                 (named range / formula, leading `=` required)
    //   "Red,Green,Blue"          (inline values, Excel's canonical XLSX form)
    // Delegates to the shared applyListSourceString helper so there is exactly one
    // parser for list-source strings across the kernel. No-ops silently if `values`
    // or `formula1` already populated an enum field.
    if (
      rule.listSource &&
      constraints.enum == null &&
      constraints.enumSource == null &&
      constraints.enumSourceFormula == null
    ) {
      applyListSourceString(rule.listSource, constraints);
    }

    const schema: RangeSchema = {
      id: rule.id ?? `rs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      createdAt: Date.now(),
      ranges: [
        {
          startId: `${startRow}:${startCol}`,
          endId: `${endRow}:${endCol}`,
        },
      ],
      schema: {
        type: validationTypeToSchemaType(rule.type),
        constraints,
      },
      enforcement: errorStyleToEnforcement(rule.errorStyle),
      ui: {
        ...(rule.showDropdown != null ? { showDropdown: rule.showDropdown } : {}),
        ...(rule.showErrorAlert !== false && (rule.errorTitle || rule.errorMessage)
          ? { errorMessage: { title: rule.errorTitle, message: rule.errorMessage ?? '' } }
          : {}),
        ...(rule.showInputMessage && (rule.inputTitle || rule.inputMessage)
          ? { inputMessage: { title: rule.inputTitle, message: rule.inputMessage ?? '' } }
          : {}),
      },
    };

    await this.ctx.computeBridge.setRangeSchema(this.sheetId, schema);
    this.ctx.eventBus.emit({
      type: 'range-schema:created',
      timestamp: Date.now(),
      sheetId: this.sheetId,
      schema: schema as unknown as RangeSchemaCreatedEvent['schema'],
      source: 'api',
    });
    const address =
      typeof a === 'string'
        ? a
        : typeof a === 'object'
          ? `R${startRow}C${startCol}:R${endRow}C${endCol}`
          : `R${a}C${b}`;
    return { kind: 'validationSet', address };
  }

  async remove(a: string | number | CellRange, b?: number): Promise<void> {
    if (typeof a === 'object') {
      // CellRange form: remove overlapping schemas (same logic as clear())
      const schemas = await getWorksheetValidationCache(this.ctx).getSchemasOverlappingRange(
        this.sheetId,
        a,
      );
      for (const schema of schemas) {
        await this.deleteSchemaAndEmit(schema);
      }
      return;
    }

    let row: number, col: number;
    if (typeof a === 'string') {
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
    } else {
      row = a;
      col = b!;
    }

    const schemas = await getWorksheetValidationCache(this.ctx).getSchemasOverlappingRange(
      this.sheetId,
      { startRow: row, startCol: col, endRow: row, endCol: col },
    );
    for (const schema of schemas) {
      await this.deleteSchemaAndEmit(schema);
    }
  }

  private async deleteSchemaAndEmit(schema: RangeSchema): Promise<void> {
    await this.ctx.computeBridge.deleteRangeSchema(this.sheetId, schema.id);
    this.ctx.eventBus.emit({
      type: 'range-schema:deleted',
      timestamp: Date.now(),
      sheetId: this.sheetId,
      schemaId: schema.id,
      schema: schema as unknown as RangeSchemaDeletedEvent['schema'],
      source: 'api',
    });
  }

  async get(a: string | number | CellRange, b?: number): Promise<ValidationRule | null> {
    if (typeof a === 'object') {
      // CellRange form: find first schema overlapping the range
      const schemas = await getWorksheetValidationCache(this.ctx).getSchemasOverlappingRange(
        this.sheetId,
        a,
      );
      return schemas[0] ? rangeSchemaToValidationRule(schemas[0]) : null;
    }

    let row: number, col: number;
    if (typeof a === 'string') {
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
    } else {
      row = a;
      col = b!;
    }

    const schema = await getWorksheetValidationCache(this.ctx).getSchemaForCell(
      this.sheetId,
      row,
      col,
    );
    return schema ? rangeSchemaToValidationRule(schema) : null;
  }

  peek(a: string | number, b?: number): ValidationRule | null | undefined {
    let row: number, col: number;
    if (typeof a === 'string') {
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
    } else {
      row = a;
      col = b!;
    }

    const schema = getWorksheetValidationCache(this.ctx).peekSchemaForCell(this.sheetId, row, col);
    return schema === undefined ? undefined : schema ? rangeSchemaToValidationRule(schema) : null;
  }

  async has(a: string | number, b?: number): Promise<boolean> {
    const result = await this.get(a, b);
    return result !== null;
  }

  async getCount(): Promise<number> {
    return (await this.list()).length;
  }

  async getDropdownItems(a: string | number, b?: number): Promise<string[]> {
    let row: number, col: number;
    if (typeof a === 'string') {
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
    } else {
      row = a;
      col = b!;
    }
    return getDropdownItems(this.ctx, this.sheetId, row, col);
  }

  async getDropdownItemsWithRevision(
    a: string | number,
    b?: number,
  ): Promise<DropdownItemsWithRevision> {
    const items =
      typeof a === 'string' ? await this.getDropdownItems(a) : await this.getDropdownItems(a, b!);
    return {
      items,
      dataRevision: JSON.stringify(items),
    };
  }

  async list(): Promise<ValidationRule[]> {
    const schemas = await getWorksheetValidationCache(this.ctx).getSchemasForSheet(this.sheetId);
    return schemas.map(rangeSchemaToValidationRule);
  }

  async clear(range?: string | CellRange): Promise<void> {
    if (range !== undefined) {
      return this.clearInRange(range);
    }
    // No-arg: remove ALL validation rules from the sheet
    const schemas = await getWorksheetValidationCache(this.ctx).getSchemasForSheet(this.sheetId);
    for (const schema of schemas) {
      await this.deleteSchemaAndEmit(schema);
    }
  }

  async clearInRange(range: string | CellRange): Promise<void> {
    const bounds = resolveRange(range);
    const schemas = await getWorksheetValidationCache(this.ctx).getSchemasOverlappingRange(
      this.sheetId,
      bounds,
    );
    for (const schema of schemas) {
      await this.deleteSchemaAndEmit(schema);
    }
  }

  async removeById(id: string): Promise<void> {
    const schemas = await this.ctx.computeBridge.getRangeSchemasForSheet(this.sheetId);
    const target = schemas.find((s) => s.id === id);
    if (target) {
      await this.deleteSchemaAndEmit(target);
    } else {
      await this.ctx.computeBridge.deleteRangeSchema(this.sheetId, id);
    }
  }

  async validate(
    a: string | number,
    b: string | number,
    c?: string,
  ): Promise<ValidationCheckResult> {
    let row: number;
    let col: number;
    let value: string;
    if (typeof a === 'string') {
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
      value = String(b);
    } else {
      row = a;
      col = b as number;
      value = String(c);
    }

    const listResult = await this.validateResolvedListValue(row, col, value);
    if (listResult) return listResult;

    const result = await this.ctx.computeBridge.validateCellValueInDoc(
      this.sheetId,
      row,
      col,
      value,
    );

    return {
      valid: result.valid,
      errorMessage: result.errorMessage,
      errorTitle: result.errorTitle,
      errorStyle: enforcementToValidationErrorStyle(result.enforcement),
    };
  }

  private async validateResolvedListValue(
    row: number,
    col: number,
    value: string,
  ): Promise<ValidationCheckResult | undefined> {
    const schema = await getWorksheetValidationCache(this.ctx).getSchemaForCell(
      this.sheetId,
      row,
      col,
    );
    if (!schema || !isListValidationSchema(schema)) return undefined;

    const constraints = schema.schema.constraints ?? {};
    const { items, resolved } = await resolveDropdownItems(this.ctx, this.sheetId, row, col);
    if (!resolved) return undefined;

    const isBlank = value === '';
    const valid =
      (isBlank && constraints.allowBlank !== false) ||
      items.some((item) => item.toLowerCase() === value.toLowerCase());
    const errorMessage = schema.ui?.errorMessage;

    return {
      valid,
      errorStyle: enforcementToValidationErrorStyle(schema.enforcement),
      errorTitle: valid ? undefined : errorMessage?.title,
      errorMessage: valid ? undefined : errorMessage?.message,
    };
  }

  async getErrorsInRange(
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): Promise<Array<{ row: number; col: number }>> {
    return Properties.queryByMetadata(
      this.ctx,
      this.sheetId,
      (meta) => (meta.validationErrors?.length ?? 0) > 0,
      { startRow, startCol, endRow, endCol },
    );
  }
}
