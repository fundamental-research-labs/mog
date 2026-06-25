/**
 * WorksheetValidationImpl — Implementation of the WorksheetValidation sub-API.
 *
 * Delegates to validation-operations.ts for range schema management.
 * Translates between the public ValidationRule type and internal RangeSchema.
 */
import type {
  CellRange,
  DropdownItemsWithRevision,
  ListValidationOptions,
  ListValidationSource,
  OperationEffect,
  SheetId,
  ValidationClearReceipt,
  ValidationCheckResult,
  ValidationRemoveReceipt,
  ValidationRule,
  ValidationSetReceipt,
  WorksheetValidation,
} from '@mog-sdk/contracts/api';

import type { RangeSchemaCreatedEvent, RangeSchemaDeletedEvent } from '@mog-sdk/contracts/events';

import type { RangeSchema } from '../../bridges/compute/compute-bridge';
import type { MutationAdmissionOptions } from '../../bridges/compute';
import type { DocumentContext } from '../../context';
import * as Properties from '../../domain/cells/cell-properties';
import { KernelError } from '../../errors';
import type { HandleLiveness } from '../lifecycle/handle-liveness';
import { createVersionOperationContext } from '../internal/version-operation-context';
import { resolveCell, resolveRange } from '../internal/address-resolver';
import { parseCellRange, rangeToA1 } from '../internal/utils';
import {
  applyListSourceString,
  errorStyleToEnforcement,
  parseRefIdSimple,
  rangeSchemaToValidationRule,
  validationRuleToConstraints,
  validationTypeToSchemaType,
} from './operations/validation-helpers';
import {
  deleteRangeSchema,
  getDropdownItems,
  resolveDropdownItems,
  setRangeSchema,
} from './operations/validation-operations';
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

function receivedType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function rangeCellCount(range: CellRange): number {
  return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
}

function schemaRangeToCellRange(rangeRef: RangeSchema['ranges'][number]): CellRange | null {
  const start = parseRefIdSimple(rangeRef.startId);
  const end = parseRefIdSimple(rangeRef.endId);
  if (!start || !end) return null;
  return {
    startRow: start.row,
    startCol: start.col,
    endRow: end.row,
    endCol: end.col,
  };
}

function schemaRangesToA1(schema: RangeSchema): string[] {
  const ranges: string[] = [];
  for (const rangeRef of schema.ranges) {
    const range = schemaRangeToCellRange(rangeRef);
    if (range) ranges.push(rangeToA1(range));
  }
  return ranges;
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function validationChangedRangeEffects(
  sheetId: SheetId,
  ranges: readonly string[],
  action: string,
): OperationEffect[] {
  return uniqueStrings(ranges).map((range) => ({
    type: 'changedRange',
    sheetId,
    range,
    details: { action },
  }));
}

function validationRemovedReceiptInput(schemas: readonly RangeSchema[]): {
  ids: string[];
  ranges: string[];
  count: number;
} {
  const ranges: string[] = [];
  for (const schema of schemas) {
    ranges.push(...schemaRangesToA1(schema));
  }
  return {
    ids: schemas.map((schema) => schema.id),
    ranges: uniqueStrings(ranges),
    count: schemas.length,
  };
}

function validationSetReceipt(params: {
  sheetId: SheetId;
  schema: RangeSchema;
  address: string;
  range: CellRange;
  rule: ValidationRule;
}): ValidationSetReceipt {
  const range = rangeToA1(params.range);
  return {
    kind: 'validationSet',
    status: 'applied',
    effects: [
      {
        type: 'changedValidation',
        sheetId: params.sheetId,
        range,
        objectId: params.schema.id,
        details: { action: 'set', validationType: params.rule.type },
      },
      {
        type: 'changedRange',
        sheetId: params.sheetId,
        range,
        count: rangeCellCount(params.range),
        details: { action: 'validation.set' },
      },
    ],
    diagnostics: [],
    address: params.address,
    validation: {
      id: params.schema.id,
      address: params.address,
      ranges: [range],
    },
  };
}

function validationRemoveReceipt(params: {
  sheetId: SheetId;
  address: string;
  schemas: readonly RangeSchema[];
  noOpRange?: string;
  requestedId?: string;
}): ValidationRemoveReceipt {
  const removed = validationRemovedReceiptInput(params.schemas);
  const status = params.schemas.length === 0 ? 'noOp' : 'applied';
  let effects: OperationEffect[];
  if (status === 'noOp') {
    let unchanged: OperationEffect = {
      type: 'worksheetUnchanged',
      sheetId: params.sheetId,
    };
    if (params.noOpRange) unchanged = { ...unchanged, range: params.noOpRange };
    if (params.requestedId) {
      unchanged = { ...unchanged, details: { validationId: params.requestedId } };
    }
    effects = [unchanged];
  } else {
    let changedValidation: OperationEffect = {
      type: 'changedValidation',
      sheetId: params.sheetId,
      count: removed.ids.length,
      details: { action: 'remove', validationIds: removed.ids },
    };
    if (removed.ranges[0]) {
      changedValidation = { ...changedValidation, range: removed.ranges[0] };
    }
    effects = [
      changedValidation,
      ...validationChangedRangeEffects(params.sheetId, removed.ranges, 'validation.remove'),
    ];
  }

  return {
    kind: 'validationRemove',
    status,
    effects,
    diagnostics: [],
    address: params.address,
    removed: { ...removed, address: params.address },
  };
}

function validationClearReceipt(params: {
  sheetId: SheetId;
  address?: string;
  schemas: readonly RangeSchema[];
  noOpRange?: string;
}): ValidationClearReceipt {
  const removed = validationRemovedReceiptInput(params.schemas);
  const status = params.schemas.length === 0 ? 'noOp' : 'applied';
  let effects: OperationEffect[];
  if (status === 'noOp') {
    let unchanged: OperationEffect = {
      type: 'worksheetUnchanged',
      sheetId: params.sheetId,
    };
    if (params.noOpRange) unchanged = { ...unchanged, range: params.noOpRange };
    effects = [unchanged];
  } else {
    let changedValidation: OperationEffect = {
      type: 'changedValidation',
      sheetId: params.sheetId,
      count: removed.ids.length,
      details: { action: 'clear', validationIds: removed.ids },
    };
    if (removed.ranges[0]) {
      changedValidation = { ...changedValidation, range: removed.ranges[0] };
    }
    effects = [
      changedValidation,
      ...validationChangedRangeEffects(params.sheetId, removed.ranges, 'validation.clear'),
    ];
  }

  const receipt: ValidationClearReceipt = {
    kind: 'validationClear',
    status,
    effects,
    diagnostics: [],
    removed: params.address ? { ...removed, address: params.address } : removed,
  };
  return params.address ? { ...receipt, address: params.address } : receipt;
}

export class WorksheetValidationImpl implements WorksheetValidation {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
    private readonly liveness?: HandleLiveness,
  ) {}

  private _assertLive(op: string): void {
    this.liveness?.assertLive(op);
  }

  private _ensureWritable(op: string): void {
    this._assertLive(op);
    this.ctx.writeGate.assertWritable(op);
  }

  private _versionAdmissionOptions(
    operationIdPrefix: string,
    groupId?: string,
  ): MutationAdmissionOptions {
    return {
      operationContext: createVersionOperationContext(this.ctx, {
        operationIdPrefix,
        sheetIds: [this.sheetId],
        domainIds: ['data-validation'],
        ...(groupId ? { groupId } : {}),
      }),
    };
  }

  private _validationGroupId(operationIdPrefix: string): string {
    const now = this.ctx.clock?.now?.() ?? Date.now();
    return `${operationIdPrefix}:${now}`;
  }

  async setList(
    a: string | number | CellRange,
    b: ListValidationSource | number,
    c?: ListValidationOptions | ListValidationSource,
    d?: ListValidationOptions,
  ): Promise<ValidationSetReceipt> {
    this._assertLive('validation.setList');
    if (typeof a === 'number') {
      return this.set(a, b as number, this.createListRule(c as ListValidationSource, d));
    }
    return this.set(a, this.createListRule(b as ListValidationSource, c as ListValidationOptions));
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

    await setRangeSchema(
      this.ctx,
      this.sheetId,
      schema,
      this._versionAdmissionOptions('validation.set'),
    );
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
    return validationSetReceipt({
      sheetId: this.sheetId,
      schema,
      address,
      range: { startRow, startCol, endRow, endCol },
      rule,
    });
  }

  private createListRule(
    source: ListValidationSource,
    options: ListValidationOptions = {},
  ): ValidationRule {
    const rule: ValidationRule = {
      type: 'list',
      allowBlank: options.allowBlank,
      showDropdown: options.showDropdown ?? true,
      showInputMessage: options.showInputMessage,
      inputTitle: options.inputTitle,
      inputMessage: options.inputMessage,
      showErrorAlert: options.showErrorAlert,
      errorStyle: options.errorStyle,
      errorTitle: options.errorTitle,
      errorMessage: options.errorMessage,
    };

    if (Array.isArray(source)) {
      if (source.length === 0) {
        throw new KernelError(
          'API_INVALID_ARGUMENT',
          'validations.setList: source must contain at least one list item.',
          {
            context: {
              issueCode: 'VALIDATION_LIST_SOURCE_EMPTY',
              path: ['source'],
              expected: 'a non-empty inline list, A1 range, formula/named source, or CellRange',
              receivedType: 'array',
            },
            path: ['source'],
            suggestion: 'Use ["Red", "Blue"] or a source range such as "D1:D10".',
          },
        );
      }
      rule.values = source.map(String);
    } else if (typeof source === 'string') {
      if (!source.trim()) {
        throw new KernelError('API_INVALID_ARGUMENT', 'validations.setList: source is empty.', {
          context: {
            issueCode: 'VALIDATION_LIST_SOURCE_EMPTY',
            path: ['source'],
            expected: 'a non-empty inline list, A1 range, formula/named source, or CellRange',
            receivedType: 'string',
          },
          path: ['source'],
          suggestion: 'Use "Red,Blue", "D1:D10", "=D1:D10", or "=NamedRange".',
        });
      }
      rule.listSource = source;
    } else if (source && typeof source === 'object') {
      rule.listSource = `=${rangeToA1(source as CellRange)}`;
    } else {
      throw new KernelError('API_INVALID_ARGUMENT', 'validations.setList: source is invalid.', {
        context: {
          issueCode: 'VALIDATION_LIST_SOURCE_INVALID',
          path: ['source'],
          expected: 'an inline string/list source or CellRange object',
          receivedType: receivedType(source),
        },
        path: ['source'],
        suggestion:
          'Use ["Red", "Blue"], "Red,Blue", "D1:D10", or { startRow, startCol, endRow, endCol }.',
      });
    }

    return rule;
  }

  async remove(a: string | number | CellRange, b?: number): Promise<ValidationRemoveReceipt> {
    this._ensureWritable('validation.remove');
    if (typeof a === 'object') {
      // CellRange form: remove overlapping schemas (same logic as clear())
      const schemas = await getWorksheetValidationCache(this.ctx).getSchemasOverlappingRange(
        this.sheetId,
        a,
      );
      const groupId = schemas.length > 1 ? this._validationGroupId('validation.remove') : undefined;
      for (const schema of schemas) {
        await this.deleteSchemaAndEmit(schema, 'validation.remove', groupId);
      }
      const address = rangeToA1(a);
      return validationRemoveReceipt({
        sheetId: this.sheetId,
        address,
        schemas,
        noOpRange: address,
      });
    }

    let row: number, col: number;
    let address: string;
    if (typeof a === 'string') {
      const pos = resolveCell(a);
      row = pos.row;
      col = pos.col;
      address = a;
    } else {
      row = a;
      col = b!;
      address = `R${a}C${b}`;
    }

    const range = { startRow: row, startCol: col, endRow: row, endCol: col };
    const schemas = await getWorksheetValidationCache(this.ctx).getSchemasOverlappingRange(
      this.sheetId,
      range,
    );
    const groupId = schemas.length > 1 ? this._validationGroupId('validation.remove') : undefined;
    for (const schema of schemas) {
      await this.deleteSchemaAndEmit(schema, 'validation.remove', groupId);
    }
    return validationRemoveReceipt({
      sheetId: this.sheetId,
      address,
      schemas,
      noOpRange: rangeToA1(range),
    });
  }

  private async deleteSchemaAndEmit(
    schema: RangeSchema,
    operationIdPrefix: string,
    groupId?: string,
  ): Promise<void> {
    await deleteRangeSchema(
      this.ctx,
      this.sheetId,
      schema.id,
      this._versionAdmissionOptions(operationIdPrefix, groupId),
    );
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
    this._assertLive('validation.get');
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
    this._assertLive('validation.peek');
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
    this._assertLive('validation.has');
    const result = await this.get(a, b);
    return result !== null;
  }

  async getCount(): Promise<number> {
    this._assertLive('validation.getCount');
    return (await this.list()).length;
  }

  async getDropdownItems(a: string | number, b?: number): Promise<string[]> {
    this._assertLive('validation.getDropdownItems');
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
    this._assertLive('validation.getDropdownItemsWithRevision');
    const items =
      typeof a === 'string' ? await this.getDropdownItems(a) : await this.getDropdownItems(a, b!);
    return {
      items,
      dataRevision: JSON.stringify(items),
    };
  }

  async list(): Promise<ValidationRule[]> {
    this._assertLive('validation.list');
    const schemas = await getWorksheetValidationCache(this.ctx).getSchemasForSheet(this.sheetId);
    return schemas.map(rangeSchemaToValidationRule);
  }

  async clear(range?: string | CellRange): Promise<ValidationClearReceipt> {
    if (range !== undefined) {
      return this.clearInRange(range);
    }
    this._ensureWritable('validation.clear');
    // No-arg: remove ALL validation rules from the sheet
    const schemas = await getWorksheetValidationCache(this.ctx).getSchemasForSheet(this.sheetId);
    const groupId = schemas.length > 1 ? this._validationGroupId('validation.clear') : undefined;
    for (const schema of schemas) {
      await this.deleteSchemaAndEmit(schema, 'validation.clear', groupId);
    }
    return validationClearReceipt({
      sheetId: this.sheetId,
      schemas,
    });
  }

  async clearInRange(range: string | CellRange): Promise<ValidationClearReceipt> {
    this._ensureWritable('validation.clearInRange');
    const bounds = resolveRange(range);
    const schemas = await getWorksheetValidationCache(this.ctx).getSchemasOverlappingRange(
      this.sheetId,
      bounds,
    );
    const groupId =
      schemas.length > 1 ? this._validationGroupId('validation.clearInRange') : undefined;
    for (const schema of schemas) {
      await this.deleteSchemaAndEmit(schema, 'validation.clearInRange', groupId);
    }
    const address = typeof range === 'string' ? range : rangeToA1(bounds);
    return validationClearReceipt({
      sheetId: this.sheetId,
      address,
      schemas,
      noOpRange: rangeToA1(bounds),
    });
  }

  async removeById(id: string): Promise<ValidationRemoveReceipt> {
    this._ensureWritable('validation.removeById');
    const schemas = await this.ctx.computeBridge.getRangeSchemasForSheet(this.sheetId);
    const target = schemas.find((s) => s.id === id);
    if (target) {
      await this.deleteSchemaAndEmit(target, 'validation.removeById');
    } else {
      await deleteRangeSchema(
        this.ctx,
        this.sheetId,
        id,
        this._versionAdmissionOptions('validation.removeById'),
      );
    }
    return validationRemoveReceipt({
      sheetId: this.sheetId,
      address: id,
      schemas: target ? [target] : [],
      requestedId: id,
    });
  }

  async validate(
    a: string | number,
    b: string | number,
    c?: string,
  ): Promise<ValidationCheckResult> {
    this._assertLive('validation.validate');
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
    this._assertLive('validation.getErrorsInRange');
    return Properties.queryByMetadata(
      this.ctx,
      this.sheetId,
      (meta) => (meta.validationErrors?.length ?? 0) > 0,
      { startRow, startCol, endRow, endCol },
    );
  }
}
