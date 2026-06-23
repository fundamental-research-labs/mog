import type {
  VersionDiffDisplay,
  VersionDiffDisplayValue,
  VersionDiffEntry,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionRedactedValue,
  VersionSemanticValue,
  VersionStoreDiagnostic,
  WorkbookDiffPage,
} from '@mog-sdk/contracts/api';
import { VERSION_DIFF_PAGE_ORDER } from '@mog-sdk/contracts/versioning';
import { projectReviewAccessDiffValue } from '../../document/version-store/review-access-projection';
import { RAW_PUBLIC_DIFF_DOMAINS, REDACTED_VALUE_REASONS } from './version-diff-constants';
import {
  degradedDiffPage,
  mapGraphDiagnostics,
  providerErrorDiagnostic,
  publicDiagnostic,
  unsupportedDiffDomainDiagnostic,
} from './version-diff-diagnostics';
import { isRecord, toPageToken, toRevision } from './version-diff-utils';

type ProjectedDiffEntry = {
  readonly entry: VersionDiffEntry;
  readonly explicitOrderKey: string | null;
  readonly sourceIndex: number;
};

export function mapDiffPageResult(value: unknown): WorkbookDiffPage {
  if (!isRecord(value)) {
    return degradedDiffPage([providerErrorDiagnostic()]);
  }
  if (value.status === 'failed' || value.status === 'degraded') {
    return degradedDiffPage(mapGraphDiagnostics(value.diagnostics));
  }
  if (value.status !== 'success') {
    return degradedDiffPage([providerErrorDiagnostic()]);
  }

  const readRevision = toRevision(value.readRevision);
  const sourceItems = Array.isArray(value.items)
    ? value.items
    : Array.isArray(value.entries)
      ? value.entries
      : Array.isArray(value.changes)
        ? value.changes
        : null;
  if (!readRevision || !sourceItems) {
    return degradedDiffPage([
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version diff service did not return a valid public diff page.',
        {
          severity: 'error',
          recoverability: 'repair',
        },
      ),
    ]);
  }

  const { items, diagnostics } = mapDiffEntries(sourceItems);
  const resultDiagnostics = [...diagnostics];
  if (value.order !== VERSION_DIFF_PAGE_ORDER) {
    resultDiagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version diff service returned an unsupported diff order.',
        {
          severity: 'error',
          recoverability: 'repair',
        },
      ),
    );
  }

  const nextPageToken =
    value.nextPageToken === undefined ? undefined : toPageToken(value.nextPageToken);
  if (value.nextPageToken !== undefined && !nextPageToken) {
    resultDiagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version diff service returned an invalid public page token.',
        {
          severity: 'error',
          recoverability: 'repair',
        },
      ),
    );
  }
  if (Array.isArray(value.diagnostics) && value.diagnostics.length > 0) {
    resultDiagnostics.push(...mapGraphDiagnostics(value.diagnostics));
  }
  if (resultDiagnostics.length > 0) {
    return degradedDiffPage(resultDiagnostics, items, readRevision);
  }

  return {
    status: 'success',
    items,
    ...(nextPageToken ? { nextPageToken } : {}),
    readRevision,
    order: VERSION_DIFF_PAGE_ORDER,
    diagnostics: [],
  };
}

function mapDiffEntries(values: readonly unknown[]): {
  readonly items: readonly VersionDiffEntry[];
  readonly diagnostics: readonly VersionStoreDiagnostic[];
} {
  const items: ProjectedDiffEntry[] = [];
  const diagnostics: VersionStoreDiagnostic[] = [];
  values.forEach((value, index) => {
    const entry = mapDiffEntry(value);
    if (entry) {
      items.push({
        entry,
        explicitOrderKey: explicitDiffOrderKey(value, entry),
        sourceIndex: index,
      });
      return;
    }
    const unsupportedDomain = unsupportedDiffDomain(value);
    diagnostics.push(
      unsupportedDomain
        ? unsupportedDiffDomainDiagnostic(unsupportedDomain, index)
        : publicDiagnostic(
            'VERSION_INVALID_COMMIT_PAYLOAD',
            'A version diff entry could not be safely projected.',
            {
              severity: 'error',
              recoverability: 'repair',
              payload: { itemIndex: index },
            },
          ),
    );
  });
  return { items: orderDiffEntries(items), diagnostics };
}

function mapDiffEntry(value: unknown): VersionDiffEntry | null {
  if (!isRecord(value)) return null;
  const structural = mapStructuralMetadata(value.structural ?? value);
  const before = structural ? mapReviewAccessDiffValue(structural, value.before) : null;
  const after = structural ? mapReviewAccessDiffValue(structural, value.after) : null;
  if (!structural || !before || !after) return null;
  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) return null;
  const diagnostics = Array.isArray(value.diagnostics)
    ? mapGraphDiagnostics(value.diagnostics)
    : undefined;
  return redactCellEntry({
    structural,
    before,
    after,
    ...(display ? { display } : {}),
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  });
}

function mapReviewAccessDiffValue(
  structural: VersionDiffStructuralMetadata,
  value: unknown,
): VersionDiffValue | null {
  const reviewValue = projectReviewAccessDiffValue(structural, value);
  if (reviewValue !== undefined) return reviewValue;
  if (structural.kind !== 'metadata') return mapDiffValue(value);
  return structural.kind === 'metadata' && RAW_PUBLIC_DIFF_DOMAINS.has(structural.domain)
    ? mapDiffValue(value)
    : null;
}

function orderDiffEntries(items: readonly ProjectedDiffEntry[]): readonly VersionDiffEntry[] {
  if (!items.some((item) => item.explicitOrderKey)) return items.map((item) => item.entry);
  return [...items]
    .sort((a, b) => diffOrderKey(a).localeCompare(diffOrderKey(b)))
    .map((item) => item.entry);
}

function diffOrderKey(item: ProjectedDiffEntry): string {
  return item.explicitOrderKey ?? fallbackDiffOrderKey(item.entry, item.sourceIndex);
}

function explicitDiffOrderKey(source: unknown, entry: VersionDiffEntry): string | null {
  const key =
    isRecord(source) && isRecord(source.pageCursorOrderKey) ? source.pageCursorOrderKey : null;
  const domainOrder = key ? Number(key.domainOrder) : NaN;
  if (
    entry.structural.kind !== 'metadata' ||
    !Number.isSafeInteger(domainOrder) ||
    typeof key?.hashPropertyPath !== 'string'
  ) {
    return null;
  }
  return semanticDiffOrderKey(
    domainOrder,
    key.hashPropertyPath,
    typeof key.canonicalEventKey === 'string' ? key.canonicalEventKey : undefined,
    typeof key.hashIdentity === 'string' ? key.hashIdentity : undefined,
    typeof key.valueClass === 'string' ? key.valueClass : 'authored',
    entry.structural.changeId,
  );
}

function fallbackDiffOrderKey(entry: VersionDiffEntry, sourceIndex: number): string {
  const structural = entry.structural;
  return structural.kind === 'metadata'
    ? semanticDiffOrderKey(
        90,
        structural.propertyPath.join('/'),
        undefined,
        structural.entityId,
        'authored',
        structural.changeId,
      )
    : semanticDiffOrderKey(100, '', undefined, undefined, 'diagnosticOnly', sourceIndex.toString());
}

function semanticDiffOrderKey(
  domainOrder: number,
  path: string,
  eventKey: string | undefined,
  identity: string | undefined,
  valueClass: string,
  changeId: string,
): string {
  return JSON.stringify([
    domainOrder.toString().padStart(5, '0'),
    path,
    eventKey ?? null,
    identity ?? null,
    valueClass,
    changeId,
  ]);
}

function redactCellEntry(entry: VersionDiffEntry): VersionDiffEntry {
  if (entry.structural.kind !== 'metadata' || entry.structural.domain !== 'cell') return entry;
  const reason = redactedReason(entry.before) ?? redactedReason(entry.after);
  if (!reason) return entry;
  const structural = redactedValue(reason);
  return {
    ...entry,
    structural,
    ...(entry.display ? { display: redactDisplay(entry.display, reason) } : {}),
  };
}

function redactDisplay(
  display: VersionDiffDisplay,
  reason: VersionRedactedValue['reason'],
): VersionDiffDisplay {
  const redacted = redactedValue(reason);
  return {
    ...(display.sheetName ? { sheetName: redacted } : {}),
    ...(display.address ? { address: redacted } : {}),
    ...(display.entityLabel ? { entityLabel: redacted } : {}),
  };
}

function redactedReason(value: VersionDiffValue): VersionRedactedValue['reason'] | null {
  return value.kind === 'redacted' ? value.reason : null;
}

function redactedValue(reason: VersionRedactedValue['reason']): VersionRedactedValue {
  return { kind: 'redacted', reason };
}

function mapStructuralMetadata(value: unknown): VersionDiffStructuralMetadata | null {
  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value)) return null;
  if (
    typeof value.changeId !== 'string' ||
    typeof value.domain !== 'string' ||
    typeof value.entityId !== 'string' ||
    !Array.isArray(value.propertyPath) ||
    !value.propertyPath.every((segment) => typeof segment === 'string')
  ) {
    return null;
  }
  return {
    kind: 'metadata',
    changeId: value.changeId,
    domain: value.domain,
    entityId: value.entityId,
    propertyPath: [...value.propertyPath],
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

function unsupportedDiffDomain(value: unknown): string | null {
  const structural = mapStructuralMetadata(isRecord(value) ? (value.structural ?? value) : value);
  if (structural?.kind !== 'metadata' || RAW_PUBLIC_DIFF_DOMAINS.has(structural.domain)) {
    return null;
  }
  const redacted = { kind: 'redacted', reason: 'permission-denied' };
  return projectReviewAccessDiffValue(structural, redacted) === undefined
    ? structural.domain
    : null;
}
