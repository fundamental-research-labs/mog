import type {
  CellFormat,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeChange,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';
import type { CellValuePrimitive } from '@mog-sdk/contracts/core';

import type { VersionMergeCommitCaptureInput } from '../../document/version-store/commit-service';
import {
  failedStoreResult,
  versionStoreDiagnostic,
  type VersionStoreFailure,
} from '../../document/version-store/provider';
import { parseCellAddress } from '../internal/utils';
import {
  DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
  inspectMaterializableMergeChange,
} from './version-merge-materializer-support';

export type ParsedCellMergeChange = {
  readonly kind: 'cellValue';
  readonly itemIndex: number;
  readonly change: VersionMergeChange;
  readonly structural: Extract<VersionDiffStructuralMetadata, { readonly kind: 'metadata' }>;
  readonly sheetId: string;
  readonly address: string;
  readonly row: number;
  readonly col: number;
  readonly merged: CellMergeValue;
};

export type ParsedDirectFormatMergeChange = {
  readonly kind: 'directCellFormat';
  readonly itemIndex: number;
  readonly change: VersionMergeChange;
  readonly structural: Extract<VersionDiffStructuralMetadata, { readonly kind: 'metadata' }>;
  readonly sheetId: string;
  readonly address: string;
  readonly row: number;
  readonly col: number;
  readonly merged: DirectFormatMergeValue;
};

export type ParsedRowColumnMergeChange = {
  readonly kind: 'rowColumnOrder';
  readonly itemIndex: number;
  readonly change: VersionMergeChange;
  readonly structural: Extract<VersionDiffStructuralMetadata, { readonly kind: 'metadata' }>;
  readonly sheetId: string;
  readonly axis: RowColumnAxis;
  readonly index: number;
  readonly transition: RowColumnTransition;
};

export type ParsedMergeChange =
  | ParsedCellMergeChange
  | ParsedDirectFormatMergeChange
  | ParsedRowColumnMergeChange;

type CellMergeValue =
  | {
      readonly kind: 'clear';
    }
  | {
      readonly kind: 'formula';
      readonly formula: string;
    }
  | {
      readonly kind: 'scalar';
      readonly value: CellValuePrimitive;
    };

type DirectFormatMergeValue =
  | {
      readonly kind: 'clear';
    }
  | {
      readonly kind: 'format';
      readonly format: CellFormat;
    };

export type RowColumnAxis = 'row' | 'column';

type RowColumnMergeValue =
  | {
      readonly kind: 'absent';
    }
  | {
      readonly kind: 'present';
      readonly sheetId: string;
      readonly axis: RowColumnAxis;
      readonly index: number;
    };

export type RowColumnTransition =
  | {
      readonly kind: 'noop';
    }
  | {
      readonly kind: 'insert';
      readonly sheetId: string;
      readonly axis: RowColumnAxis;
      readonly index: number;
    }
  | {
      readonly kind: 'delete';
      readonly sheetId: string;
      readonly axis: RowColumnAxis;
      readonly index: number;
    };

export function parseMergeChanges(input: VersionMergeCommitCaptureInput):
  | {
      readonly ok: true;
      readonly changes: readonly ParsedMergeChange[];
    }
  | {
      readonly ok: false;
      readonly failure: VersionStoreFailure;
    } {
  const parsed: ParsedMergeChange[] = [];
  for (let index = 0; index < input.changes.length; index++) {
    const change = input.changes[index];
    const support = inspectMaterializableMergeChange(change);
    if (!support.ok) {
      return unsupportedMergeChange(input, index, change.structural, {
        reason: support.reason,
        ...(support.noop === undefined ? {} : { noop: support.noop }),
      });
    }
    const structural =
      parseCellStructural(change.structural) ??
      parseDirectFormatStructural(change.structural) ??
      parseRowColumnStructural(change.structural);
    if (!structural) {
      return unsupportedMergeChange(input, index, change.structural);
    }
    if (structural.domain === 'cells.formats.direct') {
      const target = parseCellEntity(structural.entityId);
      if (!target) {
        return unsupportedMergeChange(input, index, structural, {
          reason: 'unsupportedEntityId',
        });
      }
      const merged = parseDirectFormatMergeValue(change.merged);
      if (!merged) {
        return unsupportedMergeChange(input, index, structural, {
          reason: 'unsupportedMergedValue',
        });
      }
      parsed.push({
        kind: 'directCellFormat',
        itemIndex: index,
        change,
        structural,
        sheetId: target.sheetId,
        address: target.address,
        row: target.row,
        col: target.col,
        merged,
      });
      continue;
    }
    if (structural.domain === 'rows-columns') {
      const target = parseRowColumnEntity(structural.entityId);
      if (!target) {
        return unsupportedMergeChange(input, index, structural, {
          reason: 'unsupportedEntityId',
        });
      }
      const transition = parseRowColumnTransition(change, target);
      if (!transition) {
        return unsupportedMergeChange(input, index, structural, {
          reason: 'unsupportedRowsColumnsTransition',
        });
      }
      parsed.push({
        kind: 'rowColumnOrder',
        itemIndex: index,
        change,
        structural,
        sheetId: target.sheetId,
        axis: target.axis,
        index: target.index,
        transition,
      });
      continue;
    }
    const target = parseCellEntity(structural.entityId);
    if (!target) {
      return unsupportedMergeChange(input, index, structural, {
        reason: 'unsupportedEntityId',
      });
    }
    const merged = parseCellMergeValue(change.merged, structural.domain);
    if (!merged) {
      return unsupportedMergeChange(input, index, structural, {
        reason: 'unsupportedMergedValue',
      });
    }
    parsed.push({
      kind: 'cellValue',
      itemIndex: index,
      change,
      structural,
      sheetId: target.sheetId,
      address: target.address,
      row: target.row,
      col: target.col,
      merged,
    });
  }
  return { ok: true, changes: parsed.sort(compareParsedMergeChanges) };
}

function parseCellStructural(
  structural: VersionDiffStructuralMetadata,
): Extract<VersionDiffStructuralMetadata, { readonly kind: 'metadata' }> | null {
  if (structural.kind !== 'metadata') return null;
  if (
    structural.domain !== 'cell' &&
    structural.domain !== 'cells.values' &&
    structural.domain !== 'cells.formulas'
  ) {
    return null;
  }
  if (structural.domain === 'cells.formulas') {
    return structural.propertyPath.length === 0 ||
      (structural.propertyPath.length === 1 &&
        (structural.propertyPath[0] === 'formula' || structural.propertyPath[0] === 'value'))
      ? structural
      : null;
  }
  if (
    structural.propertyPath.length !== 0 &&
    !(structural.propertyPath.length === 1 && structural.propertyPath[0] === 'value')
  ) {
    return null;
  }
  return structural;
}

function parseDirectFormatStructural(
  structural: VersionDiffStructuralMetadata,
): Extract<VersionDiffStructuralMetadata, { readonly kind: 'metadata' }> | null {
  if (structural.kind !== 'metadata') return null;
  if (structural.domain !== 'cells.formats.direct') return null;
  if (structural.propertyPath.length !== 1 || structural.propertyPath[0] !== 'format') {
    return null;
  }
  return structural;
}

function parseRowColumnStructural(
  structural: VersionDiffStructuralMetadata,
): Extract<VersionDiffStructuralMetadata, { readonly kind: 'metadata' }> | null {
  if (structural.kind !== 'metadata') return null;
  if (structural.domain !== 'rows-columns') return null;
  if (structural.propertyPath.length !== 1 || structural.propertyPath[0] !== 'order') {
    return null;
  }
  return structural;
}

function parseCellEntity(entityId: string): {
  readonly sheetId: string;
  readonly address: string;
  readonly row: number;
  readonly col: number;
} | null {
  const separator = entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entityId.length - 1) return null;
  const sheetId = entityId.slice(0, separator);
  const address = entityId.slice(separator + 1);
  const parsed = parseCellAddress(address);
  if (!parsed) return null;
  return { sheetId, address, row: parsed.row, col: parsed.col };
}

function parseRowColumnEntity(entityId: string): {
  readonly sheetId: string;
  readonly axis: RowColumnAxis;
  readonly index: number;
} | null {
  const separator = entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entityId.length - 1) return null;
  const sheetId = entityId.slice(0, separator);
  const axisAndIndex = entityId.slice(separator + 1);
  const axisSeparator = axisAndIndex.lastIndexOf(':');
  if (axisSeparator <= 0 || axisSeparator === axisAndIndex.length - 1) return null;
  const rawAxis = axisAndIndex.slice(0, axisSeparator);
  const axis = rawAxis === 'row' || rawAxis === 'column' ? rawAxis : null;
  if (!axis) return null;
  const index = Number(axisAndIndex.slice(axisSeparator + 1));
  if (!isSheetIndex(index)) return null;
  return { sheetId, axis, index };
}

function parseCellMergeValue(value: VersionDiffValue, domain: string): CellMergeValue | null {
  if (value.kind !== 'value') return null;
  if (domain === 'cells.formulas') return parseSemanticFormulaCellValue(value.value);
  return parseSemanticCellValue(value.value);
}

function parseDirectFormatMergeValue(value: VersionDiffValue): DirectFormatMergeValue | null {
  if (value.kind !== 'value') return null;
  if (value.value === null) return { kind: 'clear' };
  const plain = semanticFormatJsonValue(value.value);
  if (!isMaterializableCellFormat(plain)) return null;
  return { kind: 'format', format: plain };
}

function parseSemanticCellValue(value: VersionSemanticValue): CellMergeValue | null {
  if (value === null) return { kind: 'clear' };
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return { kind: 'scalar', value };
  }
  if (typeof value !== 'object') return null;
  if (value.kind === 'blank') return { kind: 'clear' };
  if (value.kind === 'formula') {
    return typeof value.formula === 'string' && value.formula.length > 0
      ? { kind: 'formula', formula: value.formula }
      : null;
  }
  return null;
}

function parseSemanticFormulaCellValue(value: VersionSemanticValue): CellMergeValue | null {
  if (value === null) return { kind: 'clear' };
  if (typeof value !== 'object') return null;
  if (value.kind === 'blank') return { kind: 'clear' };
  if (value.kind !== 'formula') return null;
  return typeof value.formula === 'string' && value.formula.length > 0
    ? { kind: 'formula', formula: value.formula }
    : null;
}

function parseRowColumnTransition(
  change: VersionMergeChange,
  target: { readonly sheetId: string; readonly axis: RowColumnAxis; readonly index: number },
): RowColumnTransition | null {
  const current = parseRowColumnMergeValue(change.ours ?? change.base, target);
  const merged = parseRowColumnMergeValue(change.merged, target);
  if (!current || !merged) return null;
  if (rowColumnValuesEqual(current, merged)) return { kind: 'noop' };
  if (current.kind === 'absent' && merged.kind === 'present') {
    return { kind: 'insert', sheetId: target.sheetId, axis: target.axis, index: target.index };
  }
  if (current.kind === 'present' && merged.kind === 'absent') {
    return { kind: 'delete', sheetId: target.sheetId, axis: target.axis, index: target.index };
  }
  return null;
}

function parseRowColumnMergeValue(
  value: VersionDiffValue,
  target: { readonly sheetId: string; readonly axis: RowColumnAxis; readonly index: number },
): RowColumnMergeValue | null {
  if (value.kind !== 'value') return null;
  if (value.value === null) return { kind: 'absent' };
  const fields = semanticObjectFieldMap(value.value);
  if (!fields) return null;
  const axis = fields.get('axis');
  const sheetId = fields.get('sheetId');
  const index = fields.get('index');
  if (axis !== target.axis || sheetId !== target.sheetId || index !== target.index) {
    return null;
  }
  return { kind: 'present', sheetId: target.sheetId, axis: target.axis, index: target.index };
}

function rowColumnValuesEqual(left: RowColumnMergeValue, right: RowColumnMergeValue): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'absent' || right.kind === 'absent') return true;
  return left.sheetId === right.sheetId && left.axis === right.axis && left.index === right.index;
}

function compareParsedMergeChanges(left: ParsedMergeChange, right: ParsedMergeChange): number {
  return (
    compareStrings(left.structural.domain, right.structural.domain) ||
    compareStrings(left.structural.entityId, right.structural.entityId) ||
    compareStrings(
      left.structural.propertyPath.join('\u0000'),
      right.structural.propertyPath.join('\u0000'),
    ) ||
    compareStrings(left.structural.changeId, right.structural.changeId) ||
    left.itemIndex - right.itemIndex
  );
}

function unsupportedMergeChange(
  input: VersionMergeCommitCaptureInput,
  index: number,
  structural: VersionDiffStructuralMetadata,
  details: Readonly<Record<string, string | number | boolean | null>> = {},
): { readonly ok: false; readonly failure: VersionStoreFailure } {
  return {
    ok: false,
    failure: failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_MISSING_CHANGE_SET', {
          operation: 'commitGraphWrite',
          documentScope: input.provider.documentScope,
          namespace: input.namespace,
          refName: input.currentRef.name,
          commitId: input.ours,
          safeMessage:
            'Version merge materialization supports only cell value, formula, direct cell format, and rows-columns order changes in this slice.',
          recoverability: 'unsupported',
          mutationGuarantee: 'no-write-attempted',
          details: {
            itemIndex: index,
            materializer: DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
            structuralKind: structural.kind,
            domain: structural.kind === 'metadata' ? structural.domain : 'redacted',
            propertyPath:
              structural.kind === 'metadata' ? structural.propertyPath.join('.') : 'redacted',
            ...details,
          },
        }),
      ],
      'no-write-attempted',
    ),
  };
}

function semanticFormatJsonValue(value: VersionSemanticValue, depth = 0): unknown {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!isRecord(value)) return undefined;
  if (value.kind === 'array') {
    if (!Array.isArray(value.values)) return undefined;
    const values = value.values.map((entry) => semanticFormatJsonValue(entry, depth + 1));
    return values.some((entry) => entry === undefined) ? undefined : values;
  }
  if (value.kind === 'object') {
    if (!Array.isArray(value.fields)) return undefined;
    const record: Record<string, unknown> = {};
    for (const field of value.fields) {
      if (!isRecord(field) || typeof field.key !== 'string') return undefined;
      const mapped = semanticFormatJsonValue(field.value as VersionSemanticValue, depth + 1);
      if (mapped === undefined) return undefined;
      record[field.key] = mapped;
    }
    return record;
  }
  return undefined;
}

function isMaterializableCellFormat(value: unknown): value is CellFormat {
  return isRecord(value) && Object.keys(value).length > 0 && value.kind !== 'Removed';
}

function semanticObjectFieldMap(
  value: VersionSemanticValue,
): Map<string, VersionSemanticValue> | null {
  if (!isRecord(value) || value.kind !== 'object' || !Array.isArray(value.fields)) return null;
  const fields = new Map<string, VersionSemanticValue>();
  for (const field of value.fields) {
    if (!isRecord(field) || typeof field.key !== 'string') return null;
    fields.set(field.key, field.value as VersionSemanticValue);
  }
  return fields;
}

function isSheetIndex(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
