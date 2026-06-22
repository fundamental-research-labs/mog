import type { VersionSemanticValue } from '@mog-sdk/contracts/api';
import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import type { PropertyChange } from '../../bridges/compute/compute-types.gen';

const DIRECT_CELL_FORMAT_DOMAIN_ID = 'cells.formats.direct';

type SemanticField = { key: string; value: VersionSemanticValue };

type DirectCellFormatSemanticChangeRecord = {
  readonly structural: {
    readonly kind: 'metadata';
    readonly changeId: string;
    readonly domain: string;
    readonly entityId: string;
    readonly propertyPath: readonly string[];
  };
  readonly before: {
    readonly kind: 'value';
    readonly value: VersionSemanticValue;
  };
  readonly after: {
    readonly kind: 'value';
    readonly value: VersionSemanticValue;
  };
  readonly display?: {
    readonly address?: { readonly kind: 'value'; readonly value: string };
  };
};

export function isDirectCellFormatOperation(
  operation: string,
  operationContext: VersionOperationContext | undefined,
): boolean {
  return (
    operationContext?.domainIds.includes(DIRECT_CELL_FORMAT_DOMAIN_ID) === true ||
    operation === 'compute_set_format_for_ranges' ||
    operation === 'compute_set_cell_properties_batch' ||
    operation === 'compute_set_cell_format' ||
    operation === 'compute_toggle_format_property'
  );
}

export function mapDirectCellFormatChanges(
  propertyChanges: readonly PropertyChange[],
  sequence: number,
): readonly DirectCellFormatSemanticChangeRecord[] {
  const changes: DirectCellFormatSemanticChangeRecord[] = [];

  for (const change of propertyChanges) {
    if (
      !isStableSheetId(change.sheetId) ||
      !isStableString(change.cellId) ||
      !isCellPosition(change.position)
    ) {
      continue;
    }

    const address = toA1(change.position.row, change.position.col);
    const value = semanticDirectFormatChangeValue(change);
    if (!value) continue;

    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:cell-format:${changes.length}`,
        domain: DIRECT_CELL_FORMAT_DOMAIN_ID,
        entityId: `${change.sheetId}!${address}`,
        propertyPath: ['format'],
      },
      before: { kind: 'value', value: change.kind === 'Removed' ? value : null },
      after: { kind: 'value', value: change.kind === 'Removed' ? null : value },
      display: {
        address: { kind: 'value', value: address },
      },
    });
  }

  return changes;
}

function semanticDirectFormatChangeValue(change: PropertyChange): VersionSemanticValue | null {
  if (change.kind === 'Set') return semanticFormatValue(change.format);
  if (change.kind === 'Removed') return removedFormatValue();
  return null;
}

function removedFormatValue(): VersionSemanticValue {
  return {
    kind: 'object',
    fields: [{ key: 'kind', value: 'Removed' }],
  };
}

function semanticFormatValue(value: unknown): VersionSemanticValue | null {
  if (!isRecord(value)) return null;
  const mapped = semanticJsonValue(value);
  if (!isSemanticObjectValue(mapped) || mapped.fields.length === 0) return null;
  return mapped;
}

function semanticJsonValue(value: unknown, depth = 0): VersionSemanticValue | undefined {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const values = value.map((item) => semanticJsonValue(item, depth + 1));
    if (values.some((item) => item === undefined)) return undefined;
    return { kind: 'array', values: values as VersionSemanticValue[] };
  }
  if (!isRecord(value)) return undefined;

  const fields: SemanticField[] = [];
  for (const key of Object.keys(value).sort()) {
    const fieldValue = semanticJsonValue(value[key], depth + 1);
    if (fieldValue !== undefined) {
      fields.push({ key, value: fieldValue });
    }
  }
  return { kind: 'object', fields };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSemanticObjectValue(
  value: VersionSemanticValue | undefined,
): value is Extract<VersionSemanticValue, { readonly kind: 'object' }> {
  return isRecord(value) && value.kind === 'object' && Array.isArray(value.fields);
}

function isStableSheetId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStableString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isCellPosition(value: unknown): value is { readonly row: number; readonly col: number } {
  return isRecord(value) && isSheetIndex(value.row) && isSheetIndex(value.col);
}

function isSheetIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
