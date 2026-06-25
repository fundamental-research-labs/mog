import type {
  VersionDiffDisplay,
  VersionDiffDisplayValue,
  VersionDiffEntry,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionRedactedValue,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';

import { diagnostic, type DiffServiceDiagnostic } from './diff-service-diagnostics';
import { mapEntriesWithOrderKeys, type MappedSemanticDiffEntry } from './diff-service-order-key';
import { projectReviewAccessDiffValue } from './review-access-projection';

const REDACTED_VALUE_REASONS = new Set([
  'permission-denied',
  'redaction-policy',
  'historical-acl-unavailable',
]);

export function mapSemanticChangeSet(
  payload: unknown,
):
  | { readonly ok: true; readonly items: readonly MappedSemanticDiffEntry[] }
  | { readonly ok: false; readonly diagnostics: readonly DiffServiceDiagnostic[] } {
  if (!isRecord(payload) || payload.schemaVersion !== 1) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_UNSUPPORTED_SCHEMA',
          'Semantic change-set payload is not supported by this diff slice.',
        ),
      ],
    };
  }

  const changes = Array.isArray(payload.changes) ? payload.changes : null;
  const reviewChanges =
    Array.isArray(payload.reviewChanges) && payload.reviewChanges.length > 0
      ? payload.reviewChanges
      : changes;
  if (!reviewChanges) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          'VERSION_UNSUPPORTED_SCHEMA',
          'Semantic change-set payload is not supported by this diff slice.',
        ),
      ],
    };
  }

  const entries: { readonly entry: VersionDiffEntry; readonly source: unknown }[] = [];
  for (let index = 0; index < reviewChanges.length; index++) {
    const entry = mapSemanticChange(reviewChanges[index]);
    if (!entry) {
      return {
        ok: false,
        diagnostics: [
          diagnostic(
            'VERSION_UNSUPPORTED_SCHEMA',
            'Semantic change record is not supported by this diff slice.',
            {
              details: { itemIndex: index },
            },
          ),
        ],
      };
    }
    entries.push({ entry, source: reviewChanges[index] });
  }

  return {
    ok: true,
    items: mapEntriesWithOrderKeys(entries),
  };
}

function mapSemanticChange(value: unknown): VersionDiffEntry | null {
  if (!isRecord(value)) return null;

  const structural = mapStructuralMetadata(value);
  const before = structural ? mapReviewAccessDiffValue(structural, value.before) : null;
  const after = structural ? mapReviewAccessDiffValue(structural, value.after) : null;
  if (!structural || !before || !after) return null;

  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) return null;

  return {
    structural,
    before,
    after,
    ...(display ? { display } : {}),
  };
}

function mapReviewAccessDiffValue(
  structural: VersionDiffStructuralMetadata,
  value: unknown,
): VersionDiffValue | null {
  const reviewValue = projectReviewAccessDiffValue(structural, value);
  return reviewValue === undefined ? mapDiffValue(value) : reviewValue;
}

function mapStructuralMetadata(
  value: Readonly<Record<string, unknown>>,
): VersionDiffStructuralMetadata | null {
  const structural = mapRedactedValue(value.structural);
  if (structural) return structural;
  const source = isRecord(value.structural) ? value.structural : value;

  if (
    typeof source.changeId !== 'string' ||
    typeof source.domain !== 'string' ||
    typeof source.entityId !== 'string' ||
    !Array.isArray(source.propertyPath) ||
    !source.propertyPath.every((segment) => typeof segment === 'string')
  ) {
    return null;
  }

  return {
    kind: 'metadata',
    changeId: source.changeId,
    domain: source.domain,
    entityId: source.entityId,
    propertyPath: [...source.propertyPath],
  };
}

function mapDiffValue(value: unknown): VersionDiffValue | null {
  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value) || value.kind !== 'value') return null;

  const semanticValue = mapSemanticValue(value.value);
  if (semanticValue === undefined) return null;
  return { kind: 'value', value: semanticValue };
}

function mapDiffDisplay(value: unknown): VersionDiffDisplay | null {
  if (!isRecord(value)) return null;
  const display: {
    sheetName?: VersionDiffDisplayValue;
    address?: VersionDiffDisplayValue;
    entityLabel?: VersionDiffDisplayValue;
  } = {};

  for (const key of ['sheetName', 'address', 'entityLabel'] as const) {
    if (value[key] === undefined) continue;
    const displayValue = mapDiffDisplayValue(value[key]);
    if (!displayValue) return null;
    display[key] = displayValue;
  }
  return display;
}

function mapDiffDisplayValue(value: unknown): VersionDiffDisplayValue | null {
  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value) || value.kind !== 'value' || typeof value.value !== 'string') return null;
  return { kind: 'value', value: value.value };
}

function mapRedactedValue(value: unknown): VersionRedactedValue | null {
  if (!isRecord(value) || value.kind !== 'redacted' || typeof value.reason !== 'string') {
    return null;
  }
  if (!REDACTED_VALUE_REASONS.has(value.reason)) return null;
  return {
    kind: 'redacted',
    reason: value.reason as VersionRedactedValue['reason'],
  };
}

function mapSemanticValue(value: unknown, depth = 0): VersionSemanticValue | undefined {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!isRecord(value)) return undefined;

  switch (value.kind) {
    case 'blank':
      return { kind: 'blank' };
    case 'dateTime':
      return typeof value.iso === 'string' ? { kind: 'dateTime', iso: value.iso } : undefined;
    case 'duration':
      return typeof value.iso === 'string' ? { kind: 'duration', iso: value.iso } : undefined;
    case 'error':
      if (typeof value.code !== 'string') return undefined;
      return {
        kind: 'error',
        code: value.code,
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
      };
    case 'formula': {
      if (typeof value.formula !== 'string') return undefined;
      if (!('result' in value)) return { kind: 'formula', formula: value.formula };
      const result = mapSemanticValue(value.result, depth + 1);
      return result === undefined ? undefined : { kind: 'formula', formula: value.formula, result };
    }
    case 'array': {
      if (!Array.isArray(value.values)) return undefined;
      const values = mapSemanticValues(value.values, depth + 1);
      return values ? { kind: 'array', values } : undefined;
    }
    case 'richText': {
      if (!Array.isArray(value.runs)) return undefined;
      const runs = value.runs.map((run) => {
        if (!isRecord(run) || typeof run.text !== 'string') return null;
        return {
          text: run.text,
          ...(typeof run.styleRef === 'string' ? { styleRef: run.styleRef } : {}),
        };
      });
      if (runs.some((run) => run === null)) return undefined;
      return {
        kind: 'richText',
        runs: runs as { readonly text: string; readonly styleRef?: string }[],
      };
    }
    case 'object': {
      if (!Array.isArray(value.fields)) return undefined;
      const fields = value.fields.map((field) => {
        if (!isRecord(field) || typeof field.key !== 'string') return null;
        const mappedValue = mapSemanticValue(field.value, depth + 1);
        return mappedValue === undefined ? null : { key: field.key, value: mappedValue };
      });
      if (fields.some((field) => field === null)) return undefined;
      return {
        kind: 'object',
        fields: fields as { readonly key: string; readonly value: VersionSemanticValue }[],
      };
    }
    default:
      return undefined;
  }
}

function mapSemanticValues(
  values: readonly unknown[],
  depth: number,
): readonly VersionSemanticValue[] | undefined {
  const mapped = values.map((value) => mapSemanticValue(value, depth));
  return mapped.some((value) => value === undefined)
    ? undefined
    : (mapped as readonly VersionSemanticValue[]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
